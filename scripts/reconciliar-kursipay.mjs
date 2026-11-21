// RECONCILIAÇÃO com a kursiPay (SÓ DE LEITURA). Compara os pagamentos PAGOS na kursiPay (GET /v1/payments, por intervalo de datas, com paginação) com os carregamentos que creditámos
// (topup_requests com payment_method = 'kursipay' e kursipay_pagamentos).
//
//   pnpm --filter @workspace/scripts exec tsx reconciliar-kursipay.mjs [--de AAAA-MM-DD] [--ate AAAA-MM-DD] [--json]     (por defeito: os últimos 30 dias)
//
// Reporta: (1) pagos na kursiPay SEM crédito nosso, (2) créditos nossos SEM pagamento pago na kursiPay, (3) valores (ou moedas) DIVERGENTES.
// Saída 0 = sem desvios; 1 = há desvios; 2 = erro de uso ou configuração; 3 = erro de ligação (base de dados ou kursiPay). NUNCA escreve (transação READ ONLY; só GET à kursiPay, nunca reembolsos)
// e NUNCA imprime chaves nem a ligação. A chave vem de KURSIPAY_SECRET_KEY (ambiente ou artifacts/api-server/.env). KURSIPAY_API_BASE (opcional) só aceita a API oficial ou um servidor local (testes).
import path from "node:path";
import { fileURLToPath } from "node:url";

const falha = (msg, codigo = 2) => { console.error(`❌ ${msg}`); process.exit(codigo); };
const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--json" || a === "--ajuda" || a === "-h") opt[a] = true;
  else if (a === "--de" || a === "--ate") { const v = args[++i]; if (!/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") || Number.isNaN(Date.parse(v))) falha(`${a} precisa de uma data AAAA-MM-DD.`); opt[a] = v; }
  else falha(`Argumento não reconhecido: ${a}.`);
}
if (opt["--ajuda"] || opt["-h"]) { console.log("Uso: reconciliar-kursipay.mjs [--de AAAA-MM-DD] [--ate AAAA-MM-DD] [--json]\n  Só leitura. Código de saída 0 = sem desvios; 1 = desvios."); process.exit(0); }
const dia = (d) => d.toISOString().slice(0, 10);
const hoje = new Date(), ate = opt["--ate"] ?? dia(hoje), de = opt["--de"] ?? dia(new Date(hoje.getTime() - 30 * 86400000));
if (de > ate) falha("--de tem de ser anterior ou igual a --ate.");

const aqui = path.dirname(fileURLToPath(import.meta.url));
try { const dotenv = (await import("dotenv")).default; dotenv.config({ path: path.join(aqui, "../artifacts/api-server/.env") }); } catch { /* só o ambiente */ }
const chave = (process.env.KURSIPAY_SECRET_KEY ?? "").trim();
if (!/^kp_(test|live)_(?!pk_)[A-Za-z0-9_-]{16,}$/.test(chave)) falha("KURSIPAY_SECRET_KEY em falta ou inválida (chave secreta kp_test_… ou kp_live_…).");
const bruto = (process.env.KURSIPAY_API_BASE ?? "").trim().replace(/\/+$/, "");
const API = /^https:\/\/api\.kursipay\.com(\/v1)?$/.test(bruto) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?(\/v1)?$/.test(bruto) ? (bruto.endsWith("/v1") ? bruto : `${bruto}/v1`) : "https://api.kursipay.com/v1";
const ambiente = chave.startsWith("kp_test_") ? "sandbox" : "production";

// ── kursiPay: pagamentos pagos no intervalo (um dia de folga de cada lado para não falhar fronteiras) ──
// Só se enviam os parâmetros do EXEMPLO da documentação (GET /v1/payments?status=paid,partially_refunded&from=AAAA-MM-DD&page=1): o tamanho de página fica no padrão da API (20; a documentação
// não define um máximo, e 100 era recusado com 422) e NÃO se envia `to` (a documentação não diz se aceita o dia de amanhã): o fim do intervalo filtra-se aqui, pela data de criação.
const somarDias = (s, n) => dia(new Date(Date.parse(s) + n * 86400000));
const MAX_PAGINAS = 1000;   // 1000 × 20 = 20 000 pagamentos; acima disto pede-se um intervalo mais curto
/** Remove chaves, segredos e tokens de qualquer texto que venha da API antes de o mostrar. */
const redigir = (v) => String(v ?? "").replace(/kp_(test|live)_[A-Za-z0-9_-]+/g, "kp_***").replace(/whsec_[A-Za-z0-9_-]+/g, "whsec_***").replace(/Bearer\s+\S+/gi, "Bearer ***").replace(/[\r\n]+/g, " ").slice(0, 300);
/** O erro da API para diagnóstico direto: HTTP, code, message, param, fieldErrors e os parâmetros da consulta; NUNCA a chave nem cabeçalhos. */
async function descreverErro(res, consulta) {
  let corpo = null; try { corpo = await res.json(); } catch { /* sem JSON */ }
  const e = corpo && typeof corpo === "object" && corpo.error && typeof corpo.error === "object" ? corpo.error : null;
  const partes = [`HTTP ${res.status}`];
  if (!e) partes.push("(o corpo da resposta não tem o formato de erro da kursiPay)");
  else {
    if (e.code !== undefined) partes.push(`code=${redigir(e.code)}`);
    if (e.message !== undefined) partes.push(`message=${redigir(e.message)}`);
    if (e.param !== undefined) partes.push(`param=${redigir(e.param)}`);
    if (e.fieldErrors && typeof e.fieldErrors === "object") partes.push(`fieldErrors: ${Object.entries(e.fieldErrors).slice(0, 10).map(([k, v]) => `${redigir(k)}=${redigir(v)}`).join("; ")}`);
  }
  partes.push(`consulta: GET /payments?${consulta}`);
  return partes.join(" · ");
}
async function lerPagos() {
  const todos = [];
  const limite = somarDias(ate, 1);   // o dia de folga depois de --ate (filtro local)
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const q = new URLSearchParams({ status: "paid,partially_refunded", from: somarDias(de, -1), page: String(pagina) });
    let res;
    try { res = await fetch(`${API}/payments?${q}`, { method: "GET", headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(20000) }); }
    catch { falha("Não foi possível contactar a kursiPay.", 3); }
    if (!res.ok) falha(`A kursiPay recusou a listagem de pagamentos: ${await descreverErro(res, q)}`, 3);
    let j; try { j = await res.json(); } catch { falha("Resposta inválida da kursiPay (a listagem não veio em JSON).", 3); }
    if (!Array.isArray(j?.data)) falha("Resposta inválida da kursiPay (sem a lista «data»).", 3);
    todos.push(...j.data);
    const total = Number(j?.pagination?.total ?? 0);
    if (j.data.length === 0 || todos.length >= total) break;
    if (pagina === MAX_PAGINAS) falha(`Há mais de ${MAX_PAGINAS * 20} pagamentos desde ${somarDias(de, -1)}: usa um intervalo mais curto (--de/--ate).`, 2);
  }
  const dataDe = (p) => String(p?.createdAt ?? p?.paidAt ?? "").slice(0, 10);
  return todos.filter((p) => p?.environment === ambiente && (dataDe(p) === "" || dataDe(p) <= limite));
}
const pagosKp = await lerPagos();
const kpPorId = new Map(pagosKp.map((p) => [p.id, p]));

// ── a nossa base de dados (só leitura) ──
let pool;
try { ({ pool } = await import("@workspace/db")); } catch (e) { falha(`Não foi possível ligar à base de dados (${e?.code ?? e?.name ?? "erro"}).`, 3); }
const sair = async (codigo) => { try { await pool.end(); } catch { /* ignora */ } process.exit(codigo); };
const cliente = await pool.connect().catch(async (e) => { console.error(`❌ Erro na base de dados (${e?.code ?? e?.name ?? "erro"}).`); await sair(3); });
const q = (sql, p) => cliente.query(sql, p);
const fmt = (c) => (Number(c) / 100).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

try {
  await q("begin transaction isolation level repeatable read read only");
  const nossos = (await q(`select k.id, k.kursipay_id, k.ambiente, k.valor_centimos::bigint as centimos, k.moeda, k.estado, k.pago_em, k.modo, k.metodo, t.id as topup_id, t.status, t.reference, t.amount::numeric as amount
      from kursipay_pagamentos k join topup_requests t on t.id = k.topup_request_id where k.ambiente = $1`, [ambiente])).rows;
  await q("rollback");
  const porId = new Map(nossos.filter((n) => n.kursipay_id).map((n) => [n.kursipay_id, n]));
  const porRef = new Map(nossos.map((n) => [n.reference, n]));

  // O MODO do pagamento: «direto» (sem sair do site: Multicaixa Express ou Referência) ou «hospedado» (checkout da kursiPay). Vem do nosso registo; sem registo, da própria kursiPay (chargeMode).
  const modoDe = (n, p) => n?.modo ?? (p?.chargeMode === "direct" ? "direto" : "hospedado");
  const semCredito = [], divergentes = [];
  for (const p of pagosKp) {
    const n = porId.get(p.id) ?? porRef.get(p.externalReference);
    const centimos = p?.amount?.amount, moeda = p?.amount?.currency;
    if (!n || n.status !== "aprovado") { semCredito.push({ id: p.id, modo: modoDe(n, p), metodo: n?.metodo ?? p.method ?? null, valor: fmt(centimos), referencia: p.externalReference ?? null, nosso: n ? `pedido #${n.topup_id} (${n.status})` : "sem pedido nosso" }); continue; }
    if (moeda !== "AOA" || String(n.moeda) !== "AOA" || Number(n.centimos) !== centimos || Math.round(Number(n.amount) * 100) !== centimos) {
      divergentes.push({ id: p.id, modo: modoDe(n, p), metodo: n.metodo ?? p.method ?? null, pedido: n.topup_id, kursipay: `${fmt(centimos)} ${moeda}`, nosso: `${fmt(n.centimos)} ${n.moeda} (pedido ${Number(n.amount).toFixed(2)})` });
    }
  }
  const emIntervalo = (d) => { if (!d) return false; const s = dia(new Date(d)); return s >= de && s <= ate; };
  const semPagamento = nossos.filter((n) => n.status === "aprovado" && emIntervalo(n.pago_em) && !kpPorId.has(n.kursipay_id ?? "")).map((n) => ({ pedido: n.topup_id, id: n.kursipay_id, modo: n.modo, metodo: n.metodo, valor: fmt(n.centimos), referencia: n.reference }));

  const resumo = { ambiente, de, ate, pagosNaKursipay: pagosKp.length, pagosPorModo: { direto: pagosKp.filter((p) => p.chargeMode === "direct").length, hospedado: pagosKp.filter((p) => p.chargeMode !== "direct").length }, creditadosNossos: nossos.filter((n) => n.status === "aprovado" && emIntervalo(n.pago_em)).length, pagosSemCredito: semCredito.length, creditosSemPagamento: semPagamento.length, valoresDivergentes: divergentes.length, ok: semCredito.length + semPagamento.length + divergentes.length === 0 };
  if (opt["--json"]) console.log(JSON.stringify({ resumo, pagosSemCredito: semCredito, creditosSemPagamento: semPagamento, valoresDivergentes: divergentes }, null, 2));
  else {
    console.log(`Reconciliação kursiPay (só leitura) — ambiente ${ambiente}, de ${de} a ${ate}: ${resumo.pagosNaKursipay} pagamento(s) pago(s) na kursiPay (${resumo.pagosPorModo.direto} direto(s), ${resumo.pagosPorModo.hospedado} hospedado(s)), ${resumo.creditadosNossos} crédito(s) nosso(s).\n`);
    if (semCredito.length) { console.log("PAGOS na kursiPay SEM crédito nosso:"); for (const x of semCredito) console.log(`  ${x.id}  [${x.modo}${x.metodo ? "/" + x.metodo : ""}]  ${x.valor} Kz  ref ${x.referencia ?? "—"}  → ${x.nosso}`); console.log(""); }
    if (semPagamento.length) { console.log("CRÉDITOS nossos SEM pagamento pago na kursiPay:"); for (const x of semPagamento) console.log(`  pedido #${x.pedido}  ${x.id ?? "sem id"}  ${x.valor} Kz  ref ${x.referencia}`); console.log(""); }
    if (divergentes.length) { console.log("VALORES (ou moedas) DIVERGENTES:"); for (const x of divergentes) console.log(`  ${x.id}  [${x.modo}${x.metodo ? "/" + x.metodo : ""}]  pedido #${x.pedido}: kursiPay ${x.kursipay} ≠ nosso ${x.nosso}`); console.log(""); }
    console.log(`Resumo: sem crédito ${resumo.pagosSemCredito}; sem pagamento ${resumo.creditosSemPagamento}; divergentes ${resumo.valoresDivergentes}.`);
    console.log(resumo.ok ? "✅ Tudo certo: a kursiPay e os nossos créditos batem." : "⚠️  Há desvios (código de saída 1).");
  }
  cliente.release(); await sair(resumo.ok ? 0 : 1);
} catch (e) {
  try { await q("rollback"); } catch { /* ignora */ } cliente.release();
  console.error(`❌ Erro na base de dados (${e?.code ?? e?.name ?? "erro"}).`); await sair(3);
}
