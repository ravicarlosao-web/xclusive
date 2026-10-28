#!/usr/bin/env node
// Converte os .docx do advogado (docs/legal/v1.1/originais) em JSON fiel à estrutura do documento
// (título, subtítulo, linha de versão, artigos, parágrafos, listas, tabelas, negrito/itálico) e aplica SÓ as
// alterações decididas pelo dono, listadas em docs/legal/v1.1/alteracoes.json. Sem dependências externas.
//
//   node scripts/legal/docx-para-json.mjs            -> escreve docs/legal/v1.1/*.json
//   node scripts/legal/docx-para-json.mjs --raiz D   -> usa D como raiz do repositório
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/** Documentos da v1.1: ficheiro original, ficheiro JSON e chave (a mesma de LEGAL_DOCS no servidor). */
export const DOCUMENTOS = [
  { chave: "termos", docx: "01-termos.docx", json: "01-termos.json" },
  { chave: "privacidade", docx: "02-privacidade.docx", json: "02-privacidade.json" },
  { chave: "conteudo", docx: "03-politica-de-conteudo.docx", json: "03-politica-de-conteudo.json" },
  { chave: "direitosAutor", docx: "04-direitos-de-autor.docx", json: "04-direitos-de-autor.json" },
  { chave: "reembolsos", docx: "05-reembolsos.docx", json: "05-reembolsos.json" },
];

// ── Leitura de .docx (zip) sem dependências ──────────────────────────────────
export function lerZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Ficheiro .docx inválido (zip sem diretório central).");
  const total = buf.readUInt16LE(eocd + 10); let off = buf.readUInt32LE(eocd + 16); const ficheiros = new Map();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("Zip corrompido (entrada do diretório central).");
    const metodo = buf.readUInt16LE(off + 10), tamComp = buf.readUInt32LE(off + 20), nomeLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), comLen = buf.readUInt16LE(off + 32), local = buf.readUInt32LE(off + 42);
    const nome = buf.toString("utf8", off + 46, off + 46 + nomeLen);
    const dados = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const bruto = buf.subarray(dados, dados + tamComp);
    ficheiros.set(nome, metodo === 8 ? zlib.inflateRawSync(bruto) : bruto);
    off += 46 + nomeLen + extraLen + comLen;
  }
  return ficheiros;
}

const desescapar = (s) => s.replace(/&(lt|gt|amp|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (m, nome, dec, hex) =>
  nome ? ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[nome] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)));
const ligado = (rpr, tag) => { const m = new RegExp(`<w:${tag}(?:\\s[^>]*)?\\/>`).exec(rpr); return !!m && !/w:val="(0|false)"/.test(m[0]); };

/** Runs de um parágrafo: [{ t, b?, i?, u? }], com runs vizinhos de igual formato fundidos. */
function lerRuns(xmlPar) {
  const runs = [];
  for (const r of xmlPar.match(/<w:r(?=[\s>])[\s\S]*?<\/w:r>/g) ?? []) {
    const rpr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r)?.[0] ?? "";
    let t = "";
    for (const m of r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) t += m[1] !== undefined ? desescapar(m[1]) : m[0] === "<w:tab/>" ? "\t" : "\n";
    if (!t) continue;
    const run = { t }; if (ligado(rpr, "b")) run.b = true; if (ligado(rpr, "i")) run.i = true; if (ligado(rpr, "u")) run.u = true;
    const ult = runs[runs.length - 1];
    if (ult && !!ult.b === !!run.b && !!ult.i === !!run.i && !!ult.u === !!run.u) ult.t += t; else runs.push(run);
  }
  return runs;
}

function lerNumeracao(ficheiros) {
  const xml = ficheiros.get("word/numbering.xml")?.toString("utf8"); if (!xml) return new Map();
  const abstratos = new Map();
  for (const a of xml.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) ?? []) {
    const id = /w:abstractNumId="(\d+)"/.exec(a)?.[1]; const niveis = new Map();
    for (const l of a.match(/<w:lvl\b[\s\S]*?<\/w:lvl>/g) ?? []) niveis.set(/w:ilvl="(\d+)"/.exec(l)?.[1], /<w:numFmt w:val="([^"]+)"/.exec(l)?.[1] ?? "decimal");
    abstratos.set(id, niveis);
  }
  const nums = new Map();
  for (const n of xml.match(/<w:num\b[\s\S]*?<\/w:num>/g) ?? []) nums.set(/w:numId="(\d+)"/.exec(n)?.[1], abstratos.get(/<w:abstractNumId w:val="(\d+)"/.exec(n)?.[1]));
  return nums;
}

function lerParagrafo(xml, numeracao) {
  const runs = lerRuns(xml); const texto = runs.map((r) => r.t).join("");
  const estilo = /<w:pStyle w:val="([^"]+)"/.exec(xml)?.[1] ?? ""; const jc = /<w:jc w:val="([^"]+)"/.exec(xml)?.[1] ?? "";
  const ilvl = /<w:numPr>[\s\S]*?<w:ilvl w:val="(\d+)"/.exec(xml)?.[1], numId = /<w:numPr>[\s\S]*?<w:numId w:val="(\d+)"/.exec(xml)?.[1];
  const lista = numId !== undefined && numId !== "0" ? { nivel: Number(ilvl ?? 0), formato: numeracao.get(numId)?.get(String(ilvl ?? 0)) ?? "decimal", id: numId } : null;
  return { runs, texto, estilo, jc, lista };
}

/** Lê o corpo do documento: sequência de parágrafos e tabelas, por ordem, ignorando parágrafos vazios. */
export function lerDocx(buf) {
  const ficheiros = lerZip(buf); const numeracao = lerNumeracao(ficheiros);
  const xml = ficheiros.get("word/document.xml")?.toString("utf8"); if (!xml) throw new Error("O .docx não tem word/document.xml.");
  const corpo = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? "";
  const itens = [];
  for (const m of corpo.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?=[\s>])[\s\S]*?<\/w:p>/g)) {
    if (m[0].startsWith("<w:tbl>")) {
      const linhas = (m[0].match(/<w:tr(?=[\s>])[\s\S]*?<\/w:tr>/g) ?? []).map((tr) =>
        (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((tc) => (tc.match(/<w:p(?=[\s>])[\s\S]*?<\/w:p>/g) ?? []).map((p) => lerRuns(p)).filter((r) => r.length)));
      itens.push({ tabela: linhas });
    } else { const p = lerParagrafo(m[0], numeracao); if (p.texto.trim()) itens.push({ par: p }); }
  }
  return itens;
}

const REGEX_LINHA_VERSAO = /^\d{1,2} de [a-zç]+ de \d{4} • Versão \d+(\.\d+)*$/;

/** Estrutura fiel ao documento (sem alterações do dono). */
export function estruturar(itens) {
  const blocos = []; let ordem = 0;
  for (const it of itens) {
    if (it.tabela) { blocos.push({ tipo: "tabela", linhas: it.tabela }); continue; }
    const p = it.par; ordem++;
    const base = p.jc === "center" ? { alinhamento: "centro" } : {};
    if (ordem === 1 && p.jc === "center") blocos.push({ tipo: "titulo", ...base, runs: p.runs });
    else if (ordem === 2 && p.jc === "center") blocos.push({ tipo: "subtitulo", ...base, runs: p.runs });
    else if (REGEX_LINHA_VERSAO.test(p.texto)) blocos.push({ tipo: "linha-versao", ...base, runs: p.runs });
    else if (p.estilo === "Heading2") blocos.push({ tipo: "artigo", ...base, runs: p.runs });
    else if (p.lista) blocos.push({ tipo: "li", lista: { nivel: p.lista.nivel, formato: p.lista.formato, id: p.lista.id }, runs: p.runs });
    else blocos.push({ tipo: "p", ...base, runs: p.runs });
  }
  return blocos;
}

export const textoDeRuns = (runs) => runs.map((r) => r.t).join("");

/** Aplica as alterações do manifesto a um documento. Cada entrada tem de corresponder EXATAMENTE a um parágrafo. */
export function aplicarManifesto(blocos, entradas) {
  const resultado = [...blocos];
  for (const e of entradas) {
    const idx = resultado.map((b, i) => (b.tipo !== "tabela" && textoDeRuns(b.runs) === e.original && !b.alterado ? i : -1)).filter((i) => i >= 0);
    if (idx.length !== 1) throw new Error(`Manifesto "${e.id}": o texto original foi encontrado ${idx.length} vez(es) (tem de ser exatamente 1).`);
    if (e.acao === "remover") resultado.splice(idx[0], 1);
    else if (e.acao === "substituir") {
      const b = resultado[idx[0]];
      if (b.runs.length !== 1 || b.runs[0].b || b.runs[0].i || b.runs[0].u) throw new Error(`Manifesto "${e.id}": o parágrafo tem formatação interna; a substituição não a preserva.`);
      resultado[idx[0]] = { ...b, runs: [{ t: e.resultado }], alterado: e.id };
    } else throw new Error(`Manifesto "${e.id}": ação desconhecida "${e.acao}".`);
  }
  return resultado;
}

export function gerarDocumento(docxBuf, chave, nomeDocx, entradas) {
  const itens = lerDocx(docxBuf); const blocos = aplicarManifesto(estruturar(itens), entradas.filter((e) => e.documento === chave));
  return { documento: chave, origem: { ficheiro: `originais/${nomeDocx}`, sha256: crypto.createHash("sha256").update(docxBuf).digest("hex") }, blocos };
}

export function lerManifesto(raiz) {
  const m = JSON.parse(fs.readFileSync(path.join(raiz, "docs/legal/v1.1/alteracoes.json"), "utf8"));
  const ids = new Set(); for (const e of m.alteracoes) { if (ids.has(e.id)) throw new Error(`Manifesto: id repetido "${e.id}".`); ids.add(e.id); }
  return m.alteracoes;
}

function principal() {
  const i = process.argv.indexOf("--raiz");
  const raiz = i >= 0 ? path.resolve(process.argv[i + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const entradas = lerManifesto(raiz); const usadas = new Set();
  for (const d of DOCUMENTOS) {
    const buf = fs.readFileSync(path.join(raiz, "docs/legal/v1.1/originais", d.docx));
    const doc = gerarDocumento(buf, d.chave, d.docx, entradas);
    for (const b of doc.blocos) if (b.alterado) usadas.add(b.alterado);
    for (const e of entradas) if (e.documento === d.chave && e.acao === "remover") usadas.add(e.id);
    fs.writeFileSync(path.join(raiz, "docs/legal/v1.1", d.json), JSON.stringify(doc, null, 2) + "\n");
    console.log(`${d.json}: ${doc.blocos.length} blocos`);
  }
  const falta = entradas.filter((e) => !usadas.has(e.id)); if (falta.length) throw new Error(`Entradas do manifesto não aplicadas: ${falta.map((e) => e.id).join(", ")}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();
