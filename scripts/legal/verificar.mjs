#!/usr/bin/env node
// Verificação dos textos legais (corre no build do xclusive). FALHA (código 1) se:
//   1. o JSON commitado não for igual ao regerado do .docx + manifesto (edição à mão ou JSON desatualizado);
//   2. o texto do JSON não for o do .docx (extraído por código independente) com SÓ as alterações do manifesto;
//   3. qualquer documento, resolvido com o legal-config (com NIF/sede vazios e preenchidos), ficar com {{…}}, [..], {..}
//      ou texto de placeholder antigo, ou divergir do texto esperado;
//   4. a versão/data da linha do documento divergir de LEGAL_DOCS (artifacts/api-server/src/routes/auth.ts);
//   5. as páginas legais ainda tiverem o bloco antigo "Texto em preparação" / legal-placeholder.
//
//   node scripts/legal/verificar.mjs [--raiz <pasta>]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DOCUMENTOS, gerarDocumento, lerManifesto, lerZip, textoDeRuns } from "./docx-para-json.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf("--raiz");
const RAIZ = i >= 0 ? path.resolve(process.argv[i + 1]) : path.resolve(aqui, "..", "..");
const LEGAL = path.join(RAIZ, "docs/legal/v1.1"), PAGINAS = path.join(RAIZ, "artifacts/xclusive/src/pages/legal"), AUTH = path.join(RAIZ, "artifacts/api-server/src/routes/auth.ts");
const falhas = []; let verificacoes = 0;
const ok = (cond, msg) => { verificacoes++; if (!cond) falhas.push(msg); };

// ── resolver.ts (o do site), transpilado em memória ──
const require = createRequire(import.meta.url);
const ts = require(require.resolve("typescript", { paths: [RAIZ, aqui] }));
const js = ts.transpileModule(fs.readFileSync(path.join(PAGINAS, "resolver.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const R = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

// ── extração INDEPENDENTE do texto do .docx (não usa o gerador) ──
const des = (s) => s.replace(/&(lt|gt|amp|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (m, n, d, h) => n ? ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[n] : String.fromCodePoint(d ? +d : parseInt(h, 16)));
function paragrafosDocx(buf) {
  const xml = lerZip(buf).get("word/document.xml").toString("utf8");
  return (xml.match(/<w:p(?=[\s>])[\s\S]*?<\/w:p>/g) ?? []).map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => m[1] !== undefined ? des(m[1]) : m[0] === "<w:tab/>" ? "\t" : "\n").join("")).filter((t) => t.trim());
}

const manifesto = lerManifesto(RAIZ);
const TOKENS_OK = new Set(["EMPRESA_NOME", "EMPRESA_NIF", "EMPRESA_SEDE", "EMAIL_LEGAL", "MINIMO_LEVANTAMENTO", "PRAZO_MIN", "PRAZO_MAX"]);
for (const e of manifesto) for (const t of [...(e.resultado ?? "").matchAll(/\{\{\??([A-Z_]+)\}\}/g)].map((m) => m[1])) ok(TOKENS_OK.has(t), `Manifesto "${e.id}": token desconhecido {{${t}}}.`);

// ── configurações de teste (NIF/sede vazios, só um, ambos) ──
const BASE = { empresaNome: "ORIGEM - COMÉRCIO E PRESTAÇÃO DE SERVIÇOS", emailLegal: "legal@xclusive.ao", minimoLevantamento: 5000, prazoLevantamentoMin: 5, prazoLevantamentoMax: 10 };
const CONFIGS = [
  { nome: "NIF e sede vazios", cfg: { ...BASE, empresaNif: null, empresaSede: null } },
  { nome: "só sede", cfg: { ...BASE, empresaNif: null, empresaSede: "Rua de Teste 1, Luanda, Angola" } },
  { nome: "só NIF", cfg: { ...BASE, empresaNif: "5000123456", empresaSede: null } },
  { nome: "NIF e sede", cfg: { ...BASE, empresaNif: "5000123456", empresaSede: "Rua de Teste 1, Luanda, Angola" } },
];
// resolução independente (cross-check do resolver do site)
const valor = (n, c) => ({ EMPRESA_NOME: c.empresaNome, EMPRESA_NIF: c.empresaNif ?? "", EMPRESA_SEDE: c.empresaSede ?? "", EMAIL_LEGAL: c.emailLegal, MINIMO_LEVANTAMENTO: String(c.minimoLevantamento).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " Kz", PRAZO_MIN: String(c.prazoLevantamentoMin), PRAZO_MAX: String(c.prazoLevantamentoMax) })[n];
const resolverIndep = (t, c) => t.replace(/\{\{\?(\w+)\}\}([\s\S]*?)\{\{\/\}\}/g, (_, n, corpo) => valor(n, c) ? corpo : "").replace(/\{\{(\w+)\}\}/g, (_, n) => valor(n, c));
// Só os documentos com `camposEmBranco` (o formulário 07) podem ter [..]; nos outros continuam proibidos.
const PROIBIDOS_BRANCOS = (lista) => lista.filter((rx) => rx.source !== "\\[" && rx.source !== "\\]");
const PROIBIDOS = [/\{\{/, /\}\}/, /\[/, /\]/, /\{/, /\}/, /Texto em preparação/i, /legal-placeholder/, /0\.1-rascunho/, /DENOMINAÇÃO SOCIAL/, /NIF DA SOCIEDADE/, /Endereço da sede social/, /valor em AOA/, /\[legal@/];

// ── LEGAL_DOCS (servidor) ──
const authSrc = fs.readFileSync(AUTH, "utf8"); const legalDocs = {};
for (const m of authSrc.matchAll(/(\w+):\s*\{\s*versao:\s*"([^"]+)",\s*atualizadoEm:\s*"([^"]+)"\s*\}/g)) legalDocs[m[1]] = { versao: m[2], data: m[3] };
const MESES = { janeiro: 1, fevereiro: 2, março: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

const usadas = new Set();
for (const d of DOCUMENTOS) {
  const etiqueta = `${d.json}`;
  const buf = fs.readFileSync(path.join(LEGAL, "originais", d.docx));
  let commitado; try { commitado = JSON.parse(fs.readFileSync(path.join(LEGAL, d.json), "utf8")); } catch (e) { falhas.push(`${etiqueta}: JSON ilegível (${e.message}).`); continue; }
  // 1. regerado == commitado
  let regerado; try { regerado = gerarDocumento(buf, d.chave, d.docx, manifesto); } catch (e) { falhas.push(`${etiqueta}: ${e.message}`); continue; }
  ok(JSON.stringify(regerado) === JSON.stringify(commitado), `${etiqueta}: o JSON não é igual ao regerado do .docx + manifesto (edição à mão ou desatualizado). Corre: node scripts/legal/docx-para-json.mjs`);
  for (const b of commitado.blocos) if (b.alterado) usadas.add(b.alterado);
  // 2. texto do JSON == texto do .docx com SÓ o manifesto (extração independente)
  let esperado = paragrafosDocx(buf);
  for (const e of manifesto.filter((x) => x.documento === d.chave)) {
    const idx = esperado.map((t, k) => t === e.original ? k : -1).filter((k) => k >= 0);
    ok(idx.length === 1, `${etiqueta}: manifesto "${e.id}" não corresponde a exatamente 1 parágrafo do .docx.`);
    if (idx.length !== 1) continue;
    usadas.add(e.id);
    if (e.acao === "remover") esperado.splice(idx[0], 1); else esperado[idx[0]] = e.resultado;
  }
  const doJson = commitado.blocos.filter((b) => b.tipo !== "tabela").map((b) => textoDeRuns(b.runs));
  ok(doJson.length === esperado.length && doJson.every((t, k) => t === esperado[k]), `${etiqueta}: o texto do JSON difere do .docx + manifesto${(() => { const k = doJson.findIndex((t, n) => t !== esperado[n]); return k >= 0 ? ` (1.ª diferença no parágrafo ${k + 1})` : ` (nº de parágrafos ${doJson.length} ≠ ${esperado.length})`; })()}.`);
  // 3. resolução com cada configuração
  for (const { nome, cfg } of CONFIGS) {
    let saida;
    try { saida = doJson.map((t) => R.textoResolvido(t, cfg)); } catch (e) { falhas.push(`${etiqueta} [${nome}]: ${e.message}`); continue; }
    const indep = esperado.map((t) => resolverIndep(t, cfg));
    ok(saida.length === indep.length && saida.every((t, k) => t === indep[k]), `${etiqueta} [${nome}]: o texto resolvido difere do esperado.`);
    for (const t of saida) for (const rx of (d.camposEmBranco ? PROIBIDOS_BRANCOS(PROIBIDOS) : PROIBIDOS)) ok(!rx.test(t), `${etiqueta} [${nome}]: texto proibido (${rx}) em "${t.slice(0, 80)}".`);
    ok(saida.every((t) => !/ ,|,\.|\s{2,}|\.\./.test(t.replace(/\n/g, " "))) , `${etiqueta} [${nome}]: sobraram vírgulas, pontos ou espaços a mais.`);
  }
  // 3b. campos em branco: só o documento marcado os tem (e tem-nos); a cópia para descarregar é igual ao original
  const temColchetes = doJson.some((t) => /\[[^\]]+\]/.test(t));
  if (d.camposEmBranco) ok(temColchetes, `${etiqueta}: documento marcado com camposEmBranco mas sem campos [..] (os campos em branco têm de ficar como no original).`);
  else ok(!temColchetes, `${etiqueta}: tem campos [..] mas não está marcado com camposEmBranco.`);
  if (d.descarregar) {
    let copia = null; try { copia = fs.readFileSync(path.join(RAIZ, d.descarregar)); } catch { /* falha abaixo */ }
    ok(!!copia && copia.equals(buf), `${etiqueta}: a cópia para descarregar (${d.descarregar}) não é igual, byte a byte, ao original.`);
  }
  // 4. versão e data
  const sub = commitado.blocos.find((b) => b.tipo === "subtitulo"); const linha = sub ? textoDeRuns(sub.runs).split("\n").pop() : "";
  const m = /^(\d{1,2}) de ([a-zç]+) de (\d{4}) • Versão (\d+(?:\.\d+)*)$/.exec(linha);
  ok(!!m, `${etiqueta}: não encontrei a linha "<data> • Versão X" no documento.`);
  if (m) { const data = `${m[3]}-${String(MESES[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}`; const ld = legalDocs[d.semLegalDocs ? "termos" : d.chave];
    ok(!!ld, `${etiqueta}: LEGAL_DOCS não tem a chave "${d.semLegalDocs ? "termos" : d.chave}".`);
    if (ld) { ok(ld.versao === m[4], `${etiqueta}: versão do documento (${m[4]}) ≠ LEGAL_DOCS (${ld.versao}).`); ok(ld.data === data, `${etiqueta}: data do documento (${data}) ≠ LEGAL_DOCS (${ld.data}).`); } }
}
for (const e of manifesto) ok(usadas.has(e.id), `Manifesto: a entrada "${e.id}" não foi aplicada.`);

// 5. nada do texto antigo nas páginas / LEGAL_DOCS
for (const f of fs.readdirSync(PAGINAS).filter((x) => /\.(tsx?|ts)$/.test(x) && x !== "resolver.ts")) {
  const s = fs.readFileSync(path.join(PAGINAS, f), "utf8");
  ok(!/Texto em preparação|legal-placeholder|ainda não está em vigor/.test(s), `pages/legal/${f}: ainda tem o bloco antigo "Texto em preparação" / legal-placeholder.`);
}
ok(!/0\.1-rascunho/.test(authSrc), "auth.ts: LEGAL_DOCS ainda tem versões 0.1-rascunho.");
// formatador do mínimo
for (const [n, esp] of [[5000, "5.000 Kz"], [999, "999 Kz"], [1234567, "1.234.567 Kz"], [7500.5, "7.500,50 Kz"], [0, "0 Kz"]]) ok(R.formatarKz(n) === esp, `formatarKz(${n}) = "${R.formatarKz(n)}" (esperado "${esp}").`);
// config inválida nunca resolve
ok((() => { try { R.validarConfig({ empresaNome: "x" }); return false; } catch { return true; } })(), "validarConfig aceitou uma configuração incompleta.");

if (falhas.length) { console.error(`\n✖ Textos legais: ${falhas.length} problema(s) em ${verificacoes} verificações:\n` + falhas.map((f) => "  - " + f).join("\n") + "\n"); process.exit(1); }
console.log(`✔ Textos legais v1.1: ${verificacoes} verificações ok (${DOCUMENTOS.length} documentos, ${manifesto.length} alterações do manifesto, ${CONFIGS.length} configurações).`);
