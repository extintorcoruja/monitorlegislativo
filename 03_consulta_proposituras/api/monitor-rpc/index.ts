
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { unzipSync } from "npm:fflate";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function out(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers
  });
}

function clean(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function norm(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function now() {
  return new Date().toISOString();
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo"
  }).format(new Date());
}

function sourceCode(fonte) {
  if (fonte === "Câmara") return "camara";
  if (fonte === "Senado") return "senado";
  return "alesp";
}

function sourceLabel(code) {
  if (code === "camara") return "Câmara";
  if (code === "senado") return "Senado";
  return "ALESP";
}

function labelProp(row) {
  return [row.type, row.number_text, row.year_text].filter(Boolean).join(" ");
}

async function hashSha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

async function passwordHash(password, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), function(c) {
    return c.charCodeAt(0);
  });

  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 120000,
      hash: "SHA-256"
    },
    baseKey,
    256
  );

  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function allRows(table) {
  const r = await db.from(table).select("*");
  if (r.error) throw r.error;
  return r.data || [];
}

async function oneRow(table, id) {
  const r = await db.from(table).select("*").eq("id", id).maybeSingle();
  if (r.error) throw r.error;
  return r.data;
}

async function insertRow(table, value) {
  const r = await db.from(table).insert(value).select("*").single();
  if (r.error) throw r.error;
  return r.data;
}

async function updateRow(table, id, value) {
  const r = await db.from(table).update(value).eq("id", id).select("*").single();
  if (r.error) throw r.error;
  return r.data;
}

async function getAuthVersion() {
  const r = await db.from("app_settings").select("auth_version").eq("id", 1).single();
  if (r.error) throw r.error;
  return Number(r.data.auth_version || 1);
}

async function validateSession(token) {
  if (!token) throw new Error("Sessão expirada. Entre novamente.");

  const tokenHash = await hashSha256(token);
  const r = await db
    .from("app_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (r.error) throw r.error;

  const valid =
    r.data &&
    Number(r.data.auth_version) === await getAuthVersion() &&
    new Date(r.data.expires_at).getTime() > Date.now();

  if (!valid) throw new Error("Sessão expirada. Entre novamente.");
}

async function login(password) {
  const r = await db.from("app_settings").select("*").eq("id", 1).single();
  if (r.error) throw r.error;

  const calculated = await passwordHash(
    String(password || ""),
    r.data.password_salt
  );

  if (calculated !== r.data.password_hash) {
    return { ok: false, message: "Senha incorreta." };
  }

  const token = crypto.randomUUID();

  await insertRow("app_sessions", {
    token_hash: await hashSha256(token),
    auth_version: Number(r.data.auth_version || 1),
    created_at: now(),
    expires_at: new Date(Date.now() + 21600 * 1000).toISOString()
  });

  return { ok: true, token };
}

function legacyProposition(row) {
  return {
    id: row.legacy_id || row.id,
    fonte: row.origin || sourceLabel(row.source_code),
    origem: row.origin || sourceLabel(row.source_code),
    idOficial: row.official_id || "",
    idCamara: row.chamber_id || (row.source_code === "camara" ? row.official_id : ""),
    idSenado: row.senate_id || (row.source_code === "senado" ? row.official_id : ""),
    idAlesp: row.alesp_id || (row.source_code === "alesp" ? row.official_id : ""),
    tipo: row.type || "",
    numero: row.number_text || "",
    ano: row.year_text || "",
    autor: row.author_text || "",
    ementa: row.ementa || row.title || "",
    andamento: row.andamento || "",
    dataAndamento: row.andamento_at || "",
    estadoOficial: row.official_state || "",
    dataEstadoOficial: row.official_state_at || "",
    situacaoAtual: row.current_situation || "",
    regimeTramitacao: row.current_regime || "",
    dataRegime: row.regime_at || "",
    tramitacaoAtual: row.current_movement || "",
    dataUltimaTramitacao: row.last_movement_at || "",
    orgaoAtual: row.current_organ || "",
    detalheTramitacao: row.movement_detail || "",
    link: row.official_url || "",
    tema: row.theme || "",
    status: row.monitor_status || "Monitorar",
    ultimaConsulta: row.last_checked_at || "",
    erroUltimaConsulta: row.last_error || ""
  };
}

async function getDashboard() {
  const props = (await allRows("propositions")).filter(function(p) {
    return String(p.monitor_status || "Monitorar") !== "Arquivar";
  });

  const reports = await allRows("reports");
  const verifications = await allRows("verifications");
  const todayValue = today();

  const report = reports
    .filter(function(r) {
      return String(r.report_date || "") === todayValue;
    })
    .sort(function(a, b) {
      return String(b.emitted_at || "").localeCompare(String(a.emitted_at || ""));
    })[0] || null;

  const active = verifications
    .filter(function(v) {
      return String(v.verification_date || "") === todayValue &&
        !String(v.emitted_at || "").trim() &&
        String(v.status || "") !== "FINALIZADA";
    })
    .sort(function(a, b) {
      return String(b.started_at || "").localeCompare(String(a.started_at || ""));
    })[0] || null;

  const fontes = {};
  props.forEach(function(p) {
    const f = p.origin || sourceLabel(p.source_code);
    fontes[f] = (fontes[f] || 0) + 1;
  });

  const keywords = await allRows("keywords");

  return {
    total: props.length,
    fontes,
    hoje: report ? {
      id: report.verification_id || report.id,
      data: report.report_date,
      responsavel: report.responsible,
      fimTecnico: report.technical_finished_at,
      emissao: report.emitted_at,
      status: "RELATÓRIO SALVO"
    } : null,
    emAndamento: active ? {
      id: active.id,
      responsavel: active.responsible,
      status: active.status,
      inicio: active.started_at
    } : null,
    palavras: keywords
      .filter(function(k) {
        return k.active !== false && k.active_legacy !== false;
      })
      .map(function(k) {
        return k.term;
      })
  };
}

async function getPropositions() {
  return (await allRows("propositions")).map(legacyProposition);
}

async function getAlterations() {
  const props = await allRows("propositions");
  const byId = new Map(props.map(function(p) {
    return [String(p.id), p];
  }));

  const changes = (await allRows("alterations")).sort(function(a, b) {
    return String(b.occurred_at || "").localeCompare(String(a.occurred_at || ""));
  });

  return changes.map(function(a) {
    const p = byId.get(String(a.proposition_id || ""));
    return {
      id: a.id,
      verificacaoId: a.verification_id || "",
      proposituraId: a.proposition_id || "",
      fonte: sourceLabel(a.source_code || ""),
      propositura: a.proposition_label || "",
      campo: a.field_name || "",
      campoLabel: a.field_label || "",
      anterior: a.previous_value || "",
      novo: a.new_value || "",
      status: a.status || "Pendente",
      data: a.occurred_at || "",
      observacaoAnalise: a.analysis_note || "",
      analisadoEm: a.analyzed_at || "",
      link: p ? p.official_url || "" : "",
      idOficial: p ? p.official_id || "" : ""
    };
  });
}

async function getCandidates() {
  const rows = (await allRows("candidates"))
    .filter(function(c) {
      return String(c.status || "Pendente") === "Pendente";
    })
    .sort(function(a, b) {
      return String(b.discovered_at || "").localeCompare(String(a.discovered_at || ""));
    });

  return rows.map(function(c) {
    return {
      id: c.id,
      verificationId: c.verification_id || "",
      fonte: c.origin || sourceLabel(c.source_code || ""),
      origem: c.origin || "",
      idOficial: c.official_id || "",
      tipo: c.type || "",
      numero: c.number_text || "",
      ano: c.year_text || "",
      ementa: c.ementa || c.title || "",
      status: c.status || "Pendente",
      link: c.official_url || "",
      data: c.discovered_at || "",
      responsavel: c.responsible || "",
      observacao: c.observation || "",
      decisaoEm: c.decision_at || "",
      ultimaEdicao: c.last_edited_at || "",
      validacao: c.validation || "",
      problemas: c.problems || ""
    };
  });
}

function compatibleLink(fonte, link) {
  try {
    const host = new URL(link).hostname;
    if (fonte === "Câmara") return host.includes("camara.leg.br");
    if (fonte === "Senado") return host.includes("senado.leg.br");
    if (fonte === "ALESP") return host.endsWith("al.sp.gov.br");
  } catch (_) {}
  return false;
}

async function duplicateCandidate(d, excludeId) {
  const props = await allRows("propositions");
  const candidates = await allRows("candidates");

  function key(x) {
    return norm([
      x.source_code || sourceCode(x.fonte),
      x.type || x.tipo,
      x.number_text || x.numero,
      x.year_text || x.ano
    ].join("|"));
  }

  const target = key(d);

  return {
    monitorada: props.some(function(p) {
      return String(p.id) !== String(excludeId || "") &&
        key(p) === target &&
        String(p.monitor_status || "Monitorar") !== "Arquivar";
    }),
    candidata: candidates.some(function(c) {
      return String(c.id) !== String(excludeId || "") &&
        String(c.status || "Pendente") === "Pendente" &&
        key(c) === target;
    })
  };
}

async function candidateProblems(d, strict) {
  const problems = [];

  if (!d.fonte) problems.push("Casa não informada.");
  if (!d.tipo) problems.push("Tipo não informado.");
  if (!d.numero) problems.push("Número não informado.");
  if (!d.ano) problems.push("Ano não informado.");
  if (!d.link) problems.push("Link oficial não informado.");

  if (d.link && !compatibleLink(d.fonte, d.link)) {
    problems.push("Link não corresponde à casa legislativa selecionada.");
  }

  if (strict && !d.idOficial) {
    problems.push("ID oficial não identificado. Confira o link e os dados da matéria.");
  }

  return problems;
}

async function registerCandidate(verificationId, responsible, dados) {
  const fonte = clean(dados.fonte);

  const d = {
    fonte,
    source_code: sourceCode(fonte),
    origin: fonte,
    idOficial: clean(dados.idOficial),
    tipo: clean(dados.tipo),
    numero: clean(dados.numero),
    ano: clean(dados.ano),
    ementa: clean(dados.ementa),
    link: clean(dados.link),
    observacao: clean(dados.observacao)
  };

  if (!d.fonte || !d.tipo || !d.numero || !d.ano) {
    throw new Error("Para registrar para avaliação, informe casa, tipo, número e ano.");
  }

  if (!d.link) {
    throw new Error("Informe o link oficial da propositura. Ele será usado para conferir e identificar a matéria antes da aprovação.");
  }

  const problems = await candidateProblems(d, false);
  const dup = await duplicateCandidate(d, null);

  if (dup.monitorada) throw new Error("Essa propositura já consta na base monitorada.");
  if (dup.candidata) throw new Error("Essa propositura já está aguardando avaliação.");

  await insertRow("candidates", {
    verification_id: verificationId || null,
    source_code: d.source_code,
    origin: d.origin,
    official_id: d.idOficial || null,
    type: d.tipo,
    number_text: d.numero,
    year_text: d.ano,
    ementa: d.ementa || null,
    title: d.ementa || null,
    official_url: d.link,
    responsible: clean(responsible),
    observation: d.observacao || null,
    validation: problems.length ? "Revisar" : "Pronta para avaliação",
    problems: problems.join(" | ") || null,
    status: "Pendente"
  });

  return { ok: true, problemas: problems };
}

async function editCandidate(id, dados) {
  const existing = await oneRow("candidates", id);

  if (!existing) throw new Error("Propositura para avaliação não encontrada.");
  if (String(existing.status) !== "Pendente") {
    throw new Error("Só é possível editar proposituras pendentes.");
  }

  const fonte = clean(dados.fonte);
  const d = {
    fonte,
    source_code: sourceCode(fonte),
    origin: fonte,
    idOficial: clean(dados.idOficial),
    tipo: clean(dados.tipo),
    numero: clean(dados.numero),
    ano: clean(dados.ano),
    ementa: clean(dados.ementa),
    link: clean(dados.link),
    observacao: clean(dados.observacao)
  };

  if (!d.fonte || !d.tipo || !d.numero || !d.ano || !d.link) {
    throw new Error("Casa, tipo, número, ano e link oficial são obrigatórios.");
  }

  const problems = await candidateProblems(d, false);
  const dup = await duplicateCandidate(d, id);

  if (dup.monitorada) throw new Error("Essa propositura já consta na base monitorada.");
  if (dup.candidata) throw new Error("Já existe outra propositura igual aguardando avaliação.");

  await updateRow("candidates", id, {
    source_code: d.source_code,
    origin: d.origin,
    official_id: d.idOficial || null,
    type: d.tipo,
    number_text: d.numero,
    year_text: d.ano,
    ementa: d.ementa || null,
    title: d.ementa || null,
    official_url: d.link,
    observation: d.observacao || null,
    last_edited_at: now(),
    validation: problems.length ? "Revisar" : "Pronta para avaliação",
    problems: problems.join(" | ") || null
  });

  return { ok: true, problemas: problems };
}

async function validateCandidate(id) {
  const c = await oneRow("candidates", id);

  if (!c) throw new Error("Propositura para avaliação não encontrada.");

  const problems = await candidateProblems({
    fonte: c.origin || sourceLabel(c.source_code),
    tipo: c.type,
    numero: c.number_text,
    ano: c.year_text,
    link: c.official_url,
    idOficial: c.official_id
  }, true);

  await updateRow("candidates", id, {
    validation: problems.length ? "Revisar" : "Validada",
    problems: problems.join(" | ") || null
  });

  return {
    ok: problems.length === 0,
    idOficial: c.official_id || "",
    problemas: problems
  };
}

async function approveCandidate(id) {
  const c = await oneRow("candidates", id);

  if (!c) throw new Error("Propositura para avaliação não encontrada.");
  if (String(c.status) !== "Pendente") throw new Error("Essa propositura já foi avaliada.");

  const valid = await validateCandidate(id);

  if (!valid.ok) {
    throw new Error("Antes de adicionar ao monitoramento, corrija: " + valid.problemas.join(" | "));
  }

  const p = await insertRow("propositions", {
    legacy_id: "CAND-" + String(id).slice(0, 8),
    source_code: c.source_code,
    origin: c.origin || sourceLabel(c.source_code),
    official_id: c.official_id || "",
    chamber_id: c.source_code === "camara" ? c.official_id || "" : null,
    senate_id: c.source_code === "senado" ? c.official_id || "" : null,
    alesp_id: c.source_code === "alesp" ? c.official_id || "" : null,
    type: String(c.type || "").toUpperCase(),
    number_text: String(c.number_text || ""),
    year_text: String(c.year_text || ""),
    author_text: "",
    ementa: c.ementa || "",
    title: c.ementa || "",
    official_url: c.official_url || "",
    monitor_status: "Monitorar",
    andamento: "",
    theme: ""
  });

  await updateRow("candidates", id, {
    status: "Adicionada",
    decision_at: now(),
    validation: "Validada",
    problems: null
  });

  return { ok: true, propositionId: p.id };
}

async function startVerification(responsible) {
  responsible = clean(responsible);

  if (!responsible) {
    throw new Error("Informe o responsável pela consulta.");
  }

  const v = await insertRow("verifications", {
    verification_date: today(),
    responsible,
    started_at: now(),
    status: "EM ANDAMENTO"
  });

  return {
    ok: true,
    verificationId: v.id,
    startedAt: v.started_at
  };
}

async function getVerification(id) {
  const v = await oneRow("verifications", id);

  if (!v) throw new Error("Verificação não encontrada.");

  return {
    id: v.id,
    responsavel: v.responsible,
    status: v.status,
    detalhes: v.details || {}
  };
}

async function saveVerification(id, resumo) {
  await updateRow("verifications", id, {
    technical_finished_at: now(),
    status: resumo.completa ? "CONCLUÍDA" : "PARCIAL",
    total_expected: Number(resumo.totalPrevisto || 0),
    total_verified: Number(resumo.totalVerificado || 0),
    changes_count: Number(resumo.alteracoes || 0),
    candidates_count: Number(resumo.candidatas || 0),
    active_keywords_count: Number(resumo.palavras || 0),
    searches_executed: Number(resumo.buscas || 0),
    sources_text: resumo.fontes || "Câmara, Senado, ALESP",
    details: resumo
  });

  return {
    ok: true,
    finishedAt: now()
  };
}

async function recordChange(verificationId, proposition, field, previousValue, newValue) {
  if (!newValue || norm(previousValue) === norm(newValue)) return false;

  const existing = await db
    .from("alterations")
    .select("id")
    .eq("proposition_id", proposition.id)
    .eq("field_name", field)
    .eq("previous_value", previousValue)
    .eq("new_value", newValue)
    .eq("status", "Pendente")
    .limit(1);

  if (existing.error) throw existing.error;
  if ((existing.data || []).length) return false;

  await insertRow("alterations", {
    verification_id: verificationId,
    proposition_id: proposition.id,
    source_code: proposition.source_code,
    proposition_label: labelProp(proposition),
    field_name: field,
    field_label: field === "tramitacaoAtual"
      ? (proposition.source_code === "alesp" ? "Andamento" : proposition.source_code === "senado" ? "Movimentação" : "Tramitação")
      : "Situação",
    previous_value: previousValue || "",
    new_value: newValue,
    status: "Pendente",
    occurred_at: now()
  });

  return true;
}

async function applyCurrent(verificationId, proposition, current, result) {
  const patch = {
    last_checked_at: now(),
    last_error: null
  };

  if (clean(current.situacao)) {
    if (!clean(proposition.current_situation)) {
      patch.current_situation = clean(current.situacao);
      result.baselines++;
    } else {
      const changed = await recordChange(
        verificationId,
        proposition,
        "situacaoAtual",
        proposition.current_situation,
        current.situacao
      );

      if (changed) result.alteracoes++;
      patch.current_situation = clean(current.situacao);
    }
  }

  if (clean(current.tramitacao)) {
    if (!clean(proposition.current_movement)) {
      patch.current_movement = clean(current.tramitacao);
      result.baselines++;
    } else {
      const changed = await recordChange(
        verificationId,
        proposition,
        "tramitacaoAtual",
        proposition.current_movement,
        current.tramitacao
      );

      if (changed) result.alteracoes++;
      patch.current_movement = clean(current.tramitacao);
    }
  }

  if (current.data) patch.last_movement_at = current.data;
  if (current.orgao) patch.current_organ = clean(current.orgao);
  if (current.detalhe !== undefined) patch.movement_detail = clean(current.detalhe);
  if (current.ementa) {
    patch.ementa = clean(current.ementa);
    patch.title = clean(current.ementa);
  }

  const summary = [
    current.situacao ? "Situação: " + clean(current.situacao) : "",
    current.tramitacao ? "Tramitação: " + clean(current.tramitacao) : "",
    current.orgao ? "Órgão: " + clean(current.orgao) : "",
    current.detalhe ? "Detalhe: " + clean(current.detalhe) : ""
  ].filter(Boolean).join(" — ");

  if (summary) patch.andamento = summary;

  await updateRow("propositions", proposition.id, patch);
}

async function verifyCamara(verificationId) {
  const props = (await allRows("propositions")).filter(function(p) {
    return p.source_code === "camara" &&
      String(p.monitor_status || "Monitorar") !== "Arquivar";
  });

  const result = {
    fonte: "Câmara",
    previsto: props.length,
    verificado: 0,
    alteracoes: 0,
    erros: 0,
    baselines: 0,
    detalhes: []
  };

  for (let start = 0; start < props.length; start += 8) {
    const chunk = props.slice(start, start + 8);

    const settled = await Promise.allSettled(chunk.map(async function(p) {
      if (!clean(p.official_id)) {
        throw new Error("Sem ID oficial");
      }

      const r = await fetch(
        "https://dadosabertos.camara.leg.br/api/v2/proposicoes/" +
        encodeURIComponent(p.official_id),
        { headers: { accept: "application/json" } }
      );

      if (!r.ok) throw new Error("HTTP " + r.status);

      return { proposition: p, payload: await r.json() };
    }));

    for (let i = 0; i < settled.length; i++) {
      const p = chunk[i];
      const item = settled[i];

      if (item.status === "rejected") {
        result.erros++;
        result.detalhes.push(
          labelProp(p) + ": " + String(item.reason && item.reason.message || item.reason)
        );

        await updateRow("propositions", p.id, {
          last_checked_at: now(),
          last_error: String(item.reason && item.reason.message || item.reason)
        });

        continue;
      }

      try {
        const data = item.value.payload && item.value.payload.dados;
        const status = data && data.statusProposicao || {};

        const current = {
          situacao: clean(status.descricaoSituacao),
          tramitacao: clean(status.descricaoTramitacao),
          data: clean(status.dataHora),
          orgao: clean(status.siglaOrgao),
          detalhe: clean(status.despacho),
          ementa: clean(data && data.ementa)
        };

        if (!current.situacao && !current.tramitacao && !current.detalhe) {
          throw new Error("Situação/tramitação atual não identificada");
        }

        await applyCurrent(verificationId, p, current, result);
        result.verificado++;
      } catch (error) {
        result.erros++;
        result.detalhes.push(
          labelProp(p) + ": " + (error instanceof Error ? error.message : String(error))
        );
      }
    }
  }

  const missing = props.filter(function(p) {
    return !clean(p.official_id);
  }).length;

  if (missing) {
    result.erros += missing;
    result.detalhes.push(missing + " item(ns) da Câmara sem ID oficial.");
  }

  return result;
}

function xmlTag(xml, names) {
  for (const name of names) {
    const re = new RegExp(
      "<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">",
      "i"
    );
    const match = xml.match(re);

    if (match) {
      return clean(match[1])
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'");
    }
  }

  return "";
}

async function verifySenado(verificationId) {
  const props = (await allRows("propositions")).filter(function(p) {
    return p.source_code === "senado" &&
      String(p.monitor_status || "Monitorar") !== "Arquivar";
  });

  const result = {
    fonte: "Senado",
    previsto: props.length,
    verificado: 0,
    alteracoes: 0,
    erros: 0,
    baselines: 0,
    detalhes: []
  };

  for (const p of props) {
    try {
      if (!clean(p.official_id)) throw new Error("sem ID oficial");

      const situationResponse = await fetch(
        "https://legis.senado.leg.br/dadosabertos/materia/situacaoatual/" +
        encodeURIComponent(p.official_id)
      );

      const movementResponse = await fetch(
        "https://legis.senado.leg.br/dadosabertos/materia/movimentacoes/" +
        encodeURIComponent(p.official_id)
      );

      const situationXml = await situationResponse.text();
      const movementXml = await movementResponse.text();

      const current = {
        situacao: xmlTag(situationXml, ["Situacao", "DescricaoSituacao", "SituacaoAtual"]),
        tramitacao: xmlTag(movementXml, ["DescricaoTramitacao", "Descricao", "Acao", "DescricaoAcao"]),
        data: xmlTag(movementXml, ["Data", "DataMovimentacao", "DataHora"]),
        orgao: xmlTag(movementXml, ["NomeOrgao", "SiglaOrgao", "NomeCasa", "SiglaCasa"]),
        detalhe: ""
      };

      if (!current.situacao && !current.tramitacao) {
        throw new Error("dados de situação/tramitação não identificados");
      }

      await applyCurrent(verificationId, p, current, result);
      result.verificado++;
    } catch (error) {
      result.erros++;
      result.detalhes.push(
        labelProp(p) + ": " + (error instanceof Error ? error.message : String(error))
      );

      await updateRow("propositions", p.id, {
        last_checked_at: now(),
        last_error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return result;
}

async function verifyAlesp(verificationId) {
  const props = (await allRows("propositions")).filter(function(p) {
    return p.source_code === "alesp" &&
      String(p.monitor_status || "Monitorar") !== "Arquivar";
  });

  const result = {
    fonte: "ALESP",
    previsto: props.length,
    verificado: 0,
    alteracoes: 0,
    erros: 0,
    baselines: 0,
    detalhes: []
  };

  const byId = new Map();

  props.forEach(function(p) {
    if (clean(p.official_id)) {
      byId.set(String(p.official_id), p);
    }
  });

  try {
    const r = await fetch(
      "https://www.al.sp.gov.br/repositorioDados/processo_legislativo/documento_andamento_atual.xml"
    );

    if (!r.ok) throw new Error("HTTP " + r.status);

    const xml = await r.text();
    const latest = new Map();
    const re = new RegExp(
      "<DocumentoAndamento>([\\s\\S]*?)</DocumentoAndamento>",
      "gi"
    );

    let match;

    while ((match = re.exec(xml)) !== null) {
      const block = match[1];
      const id = xmlTag(block, ["IdDocumento"]);

      if (!id || !byId.has(id)) continue;

      const data = xmlTag(block, ["Data"]);
      const order = Number(xmlTag(block, ["NrOrdem"]) || 0);
      const description = xmlTag(block, ["Descricao"]);
      const stage = xmlTag(block, ["NmEtapa"]);
      const commission = xmlTag(block, ["SiglaComissao"]);

      const current = {
        data,
        order,
        tramitacao: clean(stage || description),
        orgao: clean(commission),
        detalhe: clean(description)
      };

      const previous = latest.get(id);

      if (!previous || order >= previous.order) {
        latest.set(id, current);
      }
    }

    for (const p of props) {
      try {
        if (!clean(p.official_id)) throw new Error("Sem ID oficial ALESP");

        const current = latest.get(String(p.official_id));

        if (current) {
          await applyCurrent(verificationId, p, {
            situacao: "",
            tramitacao: current.tramitacao,
            data: current.data,
            orgao: current.orgao,
            detalhe: current.detalhe
          }, result);
        }

        await updateRow("propositions", p.id, {
          last_checked_at: now(),
          last_error: null
        });

        result.verificado++;
      } catch (error) {
        result.erros++;
        result.detalhes.push(
          labelProp(p) + ": " + (error instanceof Error ? error.message : String(error))
        );
      }
    }
  } catch (error) {
    result.erros = props.length;
    result.detalhes.push(
      "Falha geral ALESP: " + (error instanceof Error ? error.message : String(error))
    );
  }

  result.regimeAviso =
    "Regimes de tramitação da ALESP serão tratados no job específico da nova plataforma.";

  return result;
}


function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function deepField(value, keys, depth) {
  depth = depth == null ? 0 : depth;
  if (value == null || depth > 6) return "";
  const wanted = new Set(keys.map(function(k) { return norm(k); }));
  if (typeof value !== "object") return "";
  for (const key of Object.keys(value)) {
    if (wanted.has(norm(key))) {
      const v = value[key];
      if (v != null && typeof v !== "object") return String(v);
    }
  }
  for (const key of Object.keys(value)) {
    const nested = value[key];
    if (nested && typeof nested === "object") {
      const found = deepField(nested, keys, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function extractOfficialId(value) {
  const direct = deepField(value, ["id", "CodigoMateria", "Codigo", "CodigoPropositura", "IdDocumento", "IdPropositura"]);
  if (direct) return String(direct).replace(/^.*\//, "").replace(/[?#].*$/, "");
  const uri = deepField(value, ["uri", "url", "Url", "Link"]);
  const match = String(uri || "").match(/(?:idProposicao=|proposicao\/|propositura\/\?id=|materia\/)([0-9]+)/i);
  return match ? match[1] : "";
}

function buildSearchText(item) {
  try {
    return norm(JSON.stringify(item));
  } catch (_) {
    return norm(item);
  }
}

function scoreSearchItem(item, keywords) {
  const text = buildSearchText(item);
  const matched = [];
  let score = 0;
  keywords.forEach(function(k) {
    const term = norm(k.termo);
    if (term && text.includes(term)) {
      matched.push(k.termo);
      score += Number(k.peso || 5);
    }
  });
  return { matched, score };
}

function normalizeAutomaticItem(sourceCodeValue, item, matchedTerms, score, verificationId) {
  const fonte = sourceLabel(sourceCodeValue);
  let type = deepField(item, ["siglaTipo", "SiglaSubtipoMateria", "siglaSubtipoMateria", "tipo", "Tipo", "Natureza"]);
  let numberText = deepField(item, ["numero", "NumeroMateria", "numeroMateria", "Numero", "numeroProposicao"]);
  let yearText = deepField(item, ["ano", "AnoMateria", "anoMateria", "Ano"]);
  let officialId = extractOfficialId(item);
  let ementa = deepField(item, ["ementa", "EmentaMateria", "ementaMateria", "Ementa", "DescricaoEmenta", "descricaoEmenta"]);
  let author = deepField(item, ["autor", "NomeAutor", "nomeAutor", "Autor"]);
  let title = deepField(item, ["titulo", "Titulo", "DescricaoMateria", "descricaoMateria", "ApelidoMateria", "apelidoMateria"]);
  let url = deepField(item, ["url", "Url", "uri", "Uri", "Link"]);

  if (sourceCodeValue === "senado" && item && typeof item === "object") {
    type = clean(item.Sigla || item.sigla || type);
    numberText = clean(item.Numero || item.numero || numberText);
    yearText = clean(item.Ano || item.ano || yearText);
    officialId = String(item.Codigo || item.codigo || officialId || "");
    ementa = clean(item.Ementa || item.ementa || ementa);
    author = clean(item.Autor || item.autor || author);
    title = clean(item.DescricaoIdentificacao || item.descricaoIdentificacao || title || ementa);
    url = clean(item.UrlDetalheMateria || item.urlDetalheMateria || url);
  }

  if (sourceCodeValue === "camara") {
    if (!url && officialId) {
      url = "https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=" + encodeURIComponent(officialId);
    }
  } else if (sourceCodeValue === "senado") {
    if (!url && officialId) {
      url = "https://www25.senado.leg.br/web/atividade/materias/-/materia/" + encodeURIComponent(officialId);
    }
  } else if (sourceCodeValue === "alesp") {
    if (!url && officialId) {
      url = "https://www.al.sp.gov.br/propositura/?id=" + encodeURIComponent(officialId);
    }
  }

  return {
    verification_id: verificationId || null,
    source_code: sourceCodeValue,
    source_label: fonte,
    official_id: String(officialId || ""),
    type: clean(type),
    number_text: clean(numberText),
    year_text: clean(yearText),
    title: clean(title || ementa),
    ementa: clean(ementa),
    author_text: clean(author),
    official_url: clean(url),
    matched_terms: matchedTerms || [],
    score: Number(score || 0),
    raw: item
  };
}

async function automaticSearchCamara(keywords, verificationId) {
  const rows = new Map();
  const errors = [];
  const lastDate = await getLastAutomaticSearchDate("camara");
  const startDate = searchStartDate(lastDate, 45);
  for (let start = 0; start < keywords.length; start += 2) {
    const keywordBatch = keywords.slice(start, start + 2);
    await Promise.all(keywordBatch.map(async function(k) {
      try {
        const url =
          "https://dadosabertos.camara.leg.br/api/v2/proposicoes" +
          "?keywords=" + encodeURIComponent(k.termo) +
          "&dataApresentacaoInicio=" + encodeURIComponent(startDate) +
          "&dataApresentacaoFim=" + encodeURIComponent(today()) +
          "&itens=30&pagina=1&ordem=DESC&ordenarPor=id";
        const response = await fetch(url, {
          headers: {
            accept: "application/json",
            "user-agent": "MonitorLegislativo/1.0"
          }
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const payload = await response.json();
        asArray(payload && payload.dados).forEach(function(item) {
          const id = extractOfficialId(item);
          if (!id) return;
          const existing = rows.get(id);
          const scored = scoreSearchItem(item, [k]);
          const matched = existing
            ? Array.from(new Set(existing.matched_terms.concat(scored.matched)))
            : scored.matched;
          const score = existing ? Math.max(existing.score, scored.score) : scored.score;
          rows.set(id, normalizeAutomaticItem("camara", item, matched, score, verificationId));
        });
      } catch (error) {
        errors.push(k.termo + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }));
  }
  return { results: Array.from(rows.values()), startDate, errors };
}

async function automaticSearchSenado(keywords, verificationId) {
  const rows = new Map();
  const year = new Date().getFullYear();
  await Promise.all(keywords.map(async function(k) {
    const url =
      "https://legis.senado.leg.br/dadosabertos/materia/pesquisa/lista.json" +
      "?ano=" + encodeURIComponent(String(year)) +
      "&palavraChave=" + encodeURIComponent(k.termo) +
      "&tipoPalavraChave=E";
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("Senado: HTTP " + response.status + " ao pesquisar " + k.termo);
    const payload = await response.json();
    const list = payload &&
      payload.PesquisaBasicaMateria &&
      payload.PesquisaBasicaMateria.Materias &&
      payload.PesquisaBasicaMateria.Materias.Materia;
    asArray(list).forEach(function(item) {
      const id = extractOfficialId(item);
      if (!id) return;
      const existing = rows.get(id);
      // O endpoint do Senado já filtrou a matéria pelo termo desta iteração.
      // Portanto, o termo da consulta é evidência de correspondência mesmo quando
      // a API não devolve a palavra no resumo/ementa retornado.
      const scored = scoreSearchItem(item, [k]);
      const matchedFromSource = scored.matched.length ? scored.matched : [k.termo];
      const matched = existing
        ? Array.from(new Set(existing.matched_terms.concat(matchedFromSource)))
        : matchedFromSource;
      const score = existing
        ? Math.max(existing.score, Number(k.peso || 5), scored.score)
        : Math.max(Number(k.peso || 5), scored.score);
      rows.set(id, normalizeAutomaticItem("senado", item, matched, score, verificationId));
    });
  }));
  return Array.from(rows.values());
}

function xmlRecords(xml) {
  const tags = ["Propositura", "Documento", "Item", "propositura", "documento"];
  for (const tag of tags) {
    const re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "gi");
    const list = [];
    let m;
    while ((m = re.exec(xml)) !== null) list.push(m[1]);
    if (list.length) return list.map(function(block) {
      return { __xml: block };
    });
  }
  return [];
}

function normalizeXmlRecord(wrapper) {
  const xml = wrapper.__xml || "";
  return {
    IdDocumento: xmlTag(xml, ["IdDocumento", "IdPropositura", "Codigo", "idDocumento", "idPropositura"]),
    Tipo: xmlTag(xml, ["Tipo", "SiglaTipo", "TipoPropositura", "tipo"]),
    Numero: xmlTag(xml, ["Numero", "NrPropositura", "numero"]),
    Ano: xmlTag(xml, ["Ano", "AnoPropositura", "ano"]),
    Ementa: xmlTag(xml, ["Ementa", "Descricao", "ementa"]),
    Autor: xmlTag(xml, ["Autor", "NomeAutor", "autor"]),
    Url: xmlTag(xml, ["Url", "URL", "Link", "link"]),
    Texto: clean(xml.replace(/<[^>]+>/g, " "))
  };
}

function parseAlespPropositionXmlBlock(block, keywords, verificationId) {
  const id = xmlTag(block, ["IdDocumento", "IdPropositura", "Codigo", "idDocumento", "idPropositura"]);
  if (!id) return null;

  const type = xmlTag(block, [
    "SiglaNatureza", "Natureza", "Tipo", "SiglaTipo",
    "DescricaoNatureza", "DescricaoTipo"
  ]);
  const numberText = xmlTag(block, ["NroLegislativo", "Numero", "NumeroPropositura", "numero"]);
  const yearText = xmlTag(block, ["AnoLegislativo", "Ano", "AnoPropositura", "ano"]);
  const ementa = xmlTag(block, ["Ementa", "DescricaoEmenta", "Descricao", "ementa"]);
  const author = xmlTag(block, ["Autor", "NomeAutor", "autor"]);
  const title = ementa || xmlTag(block, ["Titulo", "DescricaoPropositura"]);
  const entered = xmlTag(block, ["DtEntradaSistema", "DataEntrada", "DtEntrada"]);

  const normalizedText = norm(block);
  const matched = [];
  let score = 0;
  keywords.forEach(function(k) {
    const term = norm(k.termo);
    if (term && normalizedText.includes(term)) {
      matched.push(k.termo);
      score += Number(k.peso || 5);
    }
  });
  if (!matched.length) return null;

  let officialUrl = "";
  if (id) officialUrl = "https://www.al.sp.gov.br/propositura/?id=" + encodeURIComponent(id);

  return {
    verification_id: verificationId || null,
    source_code: "alesp",
    source_label: "ALESP",
    official_id: String(id),
    type: clean(type),
    number_text: clean(numberText),
    year_text: clean(yearText),
    title: clean(title),
    ementa: clean(ementa),
    author_text: clean(author),
    official_url: officialUrl,
    matched_terms: matched,
    score,
    raw: {
      IdDocumento: id,
      Tipo: type,
      NroLegislativo: numberText,
      AnoLegislativo: yearText,
      Ementa: ementa,
      Autor: author,
      DtEntradaSistema: entered
    }
  };
}

function alespDateToIso(value) {
  const v = clean(value);
  let m = v.match(/(\\d{4})[-\\/](\\d{2})[-\\/](\\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = v.match(/(\\d{2})[-\\/](\\d{2})[-\\/](\\d{4})/);
  if (m) return m[3] + "-" + m[2] + "-" + m[1];
  return "";
}

async function automaticSearchAlesp(keywords, verificationId) {
  const zipUrl = "https://www.al.sp.gov.br/repositorioDados/processo_legislativo/proposituras.zip";
  const response = await fetch(zipUrl, {
    headers: {
      accept: "application/zip, application/octet-stream",
      "user-agent": "MonitorLegislativo/1.0"
    }
  });
  if (!response.ok) throw new Error("ALESP: HTTP " + response.status + " ao baixar proposituras.zip");

  const zipBytes = new Uint8Array(await response.arrayBuffer());
  const files = unzipSync(zipBytes);
  const fileNames = Object.keys(files);
  let fileName = fileNames.find(function(name) {
    return /(^|[\\/])proposituras?\.xml$/i.test(name.trim());
  });

  // A ALESP documenta o recurso como proposituras.xml, mas não devemos
  // depender do caminho exato armazenado dentro do ZIP.
  if (!fileName) {
    fileName = fileNames.find(function(name) {
      return /propositur/i.test(name) && /\.xml$/i.test(name);
    });
  }

  // Último fallback: identifica o XML pelo conteúdo, não pelo nome.
  if (!fileName) {
    const xmlCandidate = fileNames.find(function(name) {
      if (!/\.xml$/i.test(name)) return false;
      const candidateText = new TextDecoder("utf-8").decode(files[name]);
      return /<propositura(?:\s|>)/i.test(candidateText);
    });
    fileName = xmlCandidate || "";
  }

  if (!fileName) {
    throw new Error(
      "ALESP: XML de proposituras não identificado no ZIP. Arquivos encontrados: " +
      fileNames.slice(0, 20).join(", ")
    );
  }

  const xml = new TextDecoder("utf-8").decode(files[fileName]);
  const lastDate = await getLastAutomaticSearchDate("alesp");
  const startDate = searchStartDate(lastDate, 45);

  const rows = new Map();
  const openTagRe = /<propositura(?:\s[^>]*)?>/gi;
  const closeTag = "</propositura>";
  let pos = 0;
  while (true) {
    openTagRe.lastIndex = pos;
    const openMatch = openTagRe.exec(xml);
    if (!openMatch) break;
    const open = openMatch.index;
    const openEnd = open + openMatch[0].length;
    const end = xml.toLowerCase().indexOf(closeTag, openEnd);
    if (end < 0) break;
    const block = xml.slice(openEnd, end);
    pos = end + closeTag.length;

    const entered = alespDateToIso(xmlTag(block, ["DtEntradaSistema", "DataEntrada", "DtEntrada"]));
    const year = clean(xmlTag(block, ["AnoLegislativo", "Ano", "AnoPropositura", "ano"]));
    if (entered && entered < startDate) continue;
    if (!entered && /^\d{4}$/.test(year) && year < startDate.slice(0, 4)) continue;

    const item = parseAlespPropositionXmlBlock(block, keywords, verificationId);
    if (!item) continue;

    const existing = rows.get(item.official_id);
    if (existing) {
      item.matched_terms = Array.from(new Set(existing.matched_terms.concat(item.matched_terms)));
      item.score = Math.max(existing.score, item.score);
    }
    rows.set(item.official_id, item);
  }

  return { results: Array.from(rows.values()), startDate, errors: [] };
}

function automaticTypeCategory(type) {
  const t = norm(type).toUpperCase();
  if (!t) return "Não identificado";
  if (["REQ", "RQS", "RIC", "RCP", "RQM"].includes(t) || t.startsWith("REQ")) return "Requerimento";
  if (t.includes("EMENDA") || ["EM", "EMC", "EMA", "EMR"].includes(t)) return "Emenda";
  if (t.includes("PARECER") || ["PAR", "PDC"].includes(t)) return "Parecer";
  if (t === "VET" || t.startsWith("VETO")) return "Veto";
  if (t.includes("INDICA") || ["IND", "INC"].includes(t)) return "Indicação";
  if (["PL", "PLC", "PLP", "PLS", "PLV", "PEC", "PDC", "PDL", "PRS", "PRC", "PR", "MP", "MPV"].includes(t)) return "Projeto / Proposição";
  return "Outros";
}

async function getAutomaticSearchResults(verificationId, fonte) {
  let q = db.from("automatic_search_results").select("*").order("discovered_at", { ascending: false });
  if (verificationId) q = q.eq("verification_id", verificationId);
  if (fonte) q = q.eq("source_code", sourceCode(fonte));
  const r = await q.limit(300);
  if (r.error) throw r.error;

  const propositions = await allRows("propositions");
  const candidates = await allRows("candidates");
  const propIdKeys = new Set(propositions.filter(function(p){return String(p.monitor_status || "Monitorar") !== "Arquivar";}).map(function(p){
    return norm([p.source_code,p.official_id].join("|"));
  }));
  const propKeys = new Set(propositions.filter(function(p){return String(p.monitor_status || "Monitorar") !== "Arquivar";}).map(function(p){
    return norm([p.source_code,p.type,p.number_text,p.year_text].join("|"));
  }));
  const candIdKeys = new Set(candidates.filter(function(c){return String(c.status || "Pendente") === "Pendente";}).map(function(c){
    return norm([c.source_code,c.official_id].join("|"));
  }));
  const candKeys = new Set(candidates.filter(function(c){return String(c.status || "Pendente") === "Pendente";}).map(function(c){
    return norm([c.source_code,c.type,c.number_text,c.year_text].join("|"));
  }));

  return (r.data || []).map(function(x) {
    const idKey = norm([x.source_code,x.official_id].join("|"));
    const key = norm([x.source_code,x.type,x.number_text,x.year_text].join("|"));
    return {
      id: x.id,
      verificationId: x.verification_id || "",
      fonte: sourceLabel(x.source_code),
      idOficial: x.official_id,
      tipo: x.type || "",
      numero: x.number_text || "",
      ano: x.year_text || "",
      titulo: x.title || x.ementa || "",
      ementa: x.ementa || x.title || "",
      autor: x.author_text || "",
      link: x.official_url || "",
      termos: x.matched_terms || [],
      categoriaTipo: automaticTypeCategory(x.type),
      status: propIdKeys.has(idKey) || propKeys.has(key)
        ? "Já monitorada"
        : (candIdKeys.has(idKey) || candKeys.has(key) ? "Em avaliação" : x.status || "Nova"),
      descobertoEm: x.discovered_at,
      updatedAt: x.updated_at
    };
  });
}

async function runAutomaticSearch(verificationId, fonte, responsible) {
  const keywords = await activeKeywords();
  if (!keywords.length) throw new Error("Nenhum termo de apoio ativo.");
  const code = sourceCode(fonte);
  const source = (await allRows("sources")).find(function(s){ return s.code === code; });
  if (!source) throw new Error("Fonte legislativa não configurada: " + fonte);

  let providerResponse;
  if (code === "camara") providerResponse = await automaticSearchCamara(keywords, verificationId);
  else if (code === "senado") providerResponse = { results: await automaticSearchSenado(keywords, verificationId), errors: [] };
  else providerResponse = await automaticSearchAlesp(keywords, verificationId);

  const results = providerResponse.results || [];
  const providerErrors = providerResponse.errors || [];

  const saved = [];
  const rowsToSave = results.filter(function(item) {
    return !!item.official_id;
  }).map(function(item) {
    return {
      verification_id: verificationId || null,
      source_id: source.id,
      source_code: code,
      official_id: item.official_id,
      type: item.type || null,
      number_text: item.number_text || null,
      year_text: item.year_text || null,
      title: item.title || null,
      ementa: item.ementa || null,
      author_text: item.author_text || null,
      official_url: item.official_url || null,
      matched_terms: item.matched_terms || [],
      score: Number(item.score || 0),
      status: "NOVO",
      discovered_at: now(),
      updated_at: now(),
      raw: item.raw || {}
    };
  });
  for (let start = 0; start < rowsToSave.length; start += 50) {
    const batch = rowsToSave.slice(start, start + 50);
    const up = await db.from("automatic_search_results")
      .upsert(batch, { onConflict: "source_code,official_id" })
      .select("*");
    if (up.error) throw up.error;
    saved.push.apply(saved, up.data || []);
  }

  const searches = await allRows("manual_searches");
  const existingSearch = searches.find(function(r) {
    return String(r.verification_id || "") === String(verificationId || "") &&
      r.source_code === code;
  });
  const keywordsText = keywords.map(function(k) { return k.termo; }).join("; ");
  const manualValue = {
    verification_id: verificationId || null,
    source_id: source.id,
    source_code: code,
    query: keywordsText,
    parameters: { mode: "automatic", terms: keywords.map(function(k){ return k.termo; }) },
    responsible: clean(responsible),
    search_date: today(),
    search_time: now(),
    executed_at: now(),
    status: "Concluída",
    keywords_text: keywordsText,
    result_count: saved.length,
    results_found: saved.length,
    observation: providerErrors.length
      ? "Pesquisa automática com pendências: " + providerErrors.join(" | ")
      : "Pesquisa automática."
  };
  if (existingSearch) await updateRow("manual_searches", existingSearch.id, manualValue);
  else await insertRow("manual_searches", manualValue);

  return {
    fonte,
    encontrados: saved.length,
    erros: providerErrors,
    resultados: await getAutomaticSearchResults(verificationId, fonte)
  };
}

async function promoteAutomaticSearchResult(id, verificationId, responsible) {
  const r = await oneRow("automatic_search_results", id);
  if (!r) throw new Error("Resultado da pesquisa automática não encontrado.");
  const key = norm([r.source_code,r.type,r.number_text,r.year_text].join("|"));
  const props = await allRows("propositions");
  const already = props.some(function(p){
    const sameId = r.official_id && p.official_id &&
      norm([p.source_code,p.official_id].join("|")) === norm([r.source_code,r.official_id].join("|"));
    const sameKey = norm([p.source_code,p.type,p.number_text,p.year_text].join("|")) === key;
    return (sameId || sameKey) && String(p.monitor_status || "Monitorar") !== "Arquivar";
  });
  if (already) throw new Error("Essa propositura já consta no monitoramento.");

  const candidates = await allRows("candidates");
  const pending = candidates.some(function(c){
    const sameId = r.official_id && c.official_id &&
      norm([c.source_code,c.official_id].join("|")) === norm([r.source_code,r.official_id].join("|"));
    const sameKey = norm([c.source_code,c.type,c.number_text,c.year_text].join("|")) === key;
    return (sameId || sameKey) && String(c.status || "Pendente") === "Pendente";
  });
  if (pending) throw new Error("Essa propositura já está em avaliação.");

  const candidate = await insertRow("candidates", {
    verification_id: verificationId || r.verification_id || null,
    source_code: r.source_code,
    origin: sourceLabel(r.source_code),
    official_id: r.official_id || null,
    type: r.type || "",
    number_text: r.number_text || "",
    year_text: r.year_text || "",
    ementa: r.ementa || r.title || null,
    title: r.title || r.ementa || null,
    official_url: r.official_url || "",
    responsible: clean(responsible),
    observation: "Incluída a partir da pesquisa automática. Termos: " + (r.matched_terms || []).join("; "),
    validation: "Pronta para avaliação",
    problems: null,
    status: "Pendente"
  });

  await updateRow("automatic_search_results", id, {
    status: "EM_AVALIACAO",
    updated_at: now()
  });

  return { ok: true, candidateId: candidate.id };
}

async function ignoreAutomaticSearchResult(id) {
  await updateRow("automatic_search_results", id, {
    status: "IGNORADO",
    updated_at: now()
  });
  return { ok: true };
}

async function searchPage() {
  const keywords = await activeKeywords();

  return {
    palavras: keywords,
    fontes: [
      {
        fonte: "Câmara",
        link: "https://www.camara.leg.br/busca-portal/proposicoes/pesquisa-simplificada"
      },
      {
        fonte: "Senado",
        link: "https://www25.senado.leg.br/web/atividade/materias"
      },
      {
        fonte: "ALESP",
        link: "https://www.al.sp.gov.br/alesp/pesquisa-proposicoes/"
      }
    ]
  };
}

async function getLastAutomaticSearchDate(sourceCodeValue) {
  const r = await db.from("manual_searches")
    .select("search_date,executed_at,parameters,status")
    .eq("source_code", sourceCodeValue)
    .eq("status", "Concluída")
    .order("executed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) return "";
  const params = r.data.parameters || {};
  if (params.mode && params.mode !== "automatic") return "";
  return clean(r.data.search_date || "");
}

function searchStartDate(lastDate, fallbackDays) {
  const fallback = new Date(Date.now() - fallbackDays * 86400000);
  if (!lastDate) return fallback.toISOString().slice(0, 10);
  const m = String(lastDate).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  const br = String(lastDate).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return br[3] + "-" + br[2] + "-" + br[1];
  return fallback.toISOString().slice(0, 10);
}

async function activeKeywords() {
  const rows = await allRows("keywords");

  return rows
    .filter(function(k) {
      return k.active !== false && k.active_legacy !== false;
    })
    .map(function(k) {
      return {
        id: k.id,
        termo: k.term,
        peso: k.weight || 5,
        ativa: "Sim"
      };
    });
}

async function guidedSearch(verificationId) {
  const searches = (await allRows("manual_searches")).filter(function(r) {
    return String(r.verification_id || "") === String(verificationId);
  });

  const map = new Map();
  searches.forEach(function(r) {
    map.set(r.source_code, r);
  });

  function house(fonte, code, link) {
    const r = map.get(code);

    return {
      fonte,
      link,
      registro: r ? {
        id: r.id,
        verificationId,
        fonte,
        responsavel: r.responsible || "",
        data: r.search_date || "",
        hora: r.search_time || "",
        status: r.status || "Pendente",
        palavras: r.keywords_text || "",
        resultadosEncontrados: Number(r.results_found || 0),
        observacao: r.observation || ""
      } : null
    };
  }

  return {
    palavras: (await activeKeywords()).map(function(k) {
      return k.termo;
    }),
    fontes: [
      house(
        "Câmara",
        "camara",
        "https://www.camara.leg.br/busca-portal/proposicoes/pesquisa-simplificada"
      ),
      house(
        "Senado",
        "senado",
        "https://www25.senado.leg.br/web/atividade/materias"
      ),
      house(
        "ALESP",
        "alesp",
        "https://www.al.sp.gov.br/alesp/pesquisa-proposicoes/"
      )
    ]
  };
}

async function saveManualSearch(verificationId, responsible, fonte, quantity) {
  const code = sourceCode(fonte);
  const existing = (await allRows("manual_searches")).find(function(r) {
    return String(r.verification_id || "") === String(verificationId) &&
      r.source_code === code;
  });

  const keywords = (await activeKeywords()).map(function(k) {
    return k.termo;
  });

  const source = (await allRows("sources")).find(function(s) {
    return s.code === code;
  });

  const value = {
    verification_id: verificationId,
    source_id: source ? source.id : null,
    source_code: code,
    query: keywords.join("; "),
    responsible: clean(responsible),
    search_date: today(),
    search_time: now(),
    status: "Concluída",
    keywords_text: (await activeKeywords()).map(function(k) {
      return k.termo;
    }).join("; "),
    results_found: Number(quantity || 0),
    observation: ""
  };

  if (existing) {
    await updateRow("manual_searches", existing.id, value);
  } else {
    await insertRow("manual_searches", value);
  }

  return guidedSearch(verificationId);
}

async function prepareReport(verificationId) {
  const v = await oneRow("verifications", verificationId);

  if (!v) throw new Error("Verificação não encontrada.");

  const searches = (await allRows("manual_searches")).filter(function(r) {
    return String(r.verification_id || "") === String(verificationId);
  });

  const completed = ["camara", "senado", "alesp"].every(function(code) {
    return searches.some(function(r) {
      return r.source_code === code && r.status === "Concluída";
    });
  });

  if (!completed) {
    throw new Error("Conclua a pesquisa nas três casas antes de revisar o relatório.");
  }

  if (String(v.status) !== "CONCLUÍDA") {
    throw new Error("A verificação automática ainda possui pendências. Resolva antes de revisar o relatório.");
  }

  return {
    id: v.id,
    data: v.verification_date,
    responsavel: v.responsible,
    inicio: v.started_at,
    fimTecnico: v.technical_finished_at,
    emissao: v.emitted_at,
    status: v.status,
    observacao: "",
    totalPrevisto: v.total_expected,
    totalVerificado: v.total_verified,
    alteracoes: v.changes_count,
    candidatas: v.candidates_count,
    palavrasAtivas: v.active_keywords_count,
    buscasExecutadas: v.searches_executed,
    fontes: v.sources_text,
    detalhes: v.details || {},
    buscasManuais: searches.map(function(r) {
      return {
        fonte: sourceLabel(r.source_code),
        responsavel: r.responsible,
        data: r.search_date,
        hora: r.search_time,
        status: r.status,
        palavras: r.keywords_text,
        resultadosEncontrados: r.results_found,
        observacao: r.observation
      };
    })
  };
}

async function saveReport(verificationId, observation) {
  observation = clean(observation);

  if (!observation) {
    throw new Error("Informe a observação antes de salvar.");
  }

  const v = await oneRow("verifications", verificationId);
  if (!v) throw new Error("Verificação não encontrada.");

  const searches = (await allRows("manual_searches")).filter(function(r) {
    return String(r.verification_id || "") === String(verificationId);
  });

  const completed = ["camara", "senado", "alesp"].every(function(code) {
    return searches.some(function(r) {
      return r.source_code === code && r.status === "Concluída";
    });
  });

  if (!completed) {
    throw new Error("Conclua a pesquisa guiada de novas proposituras nas três casas antes de salvar o relatório.");
  }

  const emitted = now();

  const report = {
    id: v.id,
    data: v.verification_date,
    responsavel: v.responsible,
    inicio: v.started_at,
    fimTecnico: v.technical_finished_at,
    emissao: emitted,
    status: v.status,
    observacao: observation,
    totalPrevisto: v.total_expected,
    totalVerificado: v.total_verified,
    alteracoes: v.changes_count,
    candidatas: v.candidates_count,
    palavrasAtivas: v.active_keywords_count,
    buscasExecutadas: v.searches_executed,
    fontes: v.sources_text,
    detalhes: v.details || {},
    buscasManuais: searches.map(function(r) {
      return {
        fonte: sourceLabel(r.source_code),
        responsavel: r.responsible,
        data: r.search_date,
        hora: r.search_time,
        status: r.status,
        palavras: r.keywords_text,
        resultadosEncontrados: r.results_found,
        observacao: r.observation
      };
    })
  };

  await updateRow("verifications", verificationId, {
    emitted_at: emitted,
    status: "FINALIZADA"
  });

  await insertRow("reports", {
    verification_id: verificationId,
    report_date: v.verification_date,
    responsible: v.responsible,
    started_at: v.started_at,
    technical_finished_at: v.technical_finished_at,
    emitted_at: emitted,
    status: v.status,
    observation: observation,
    total_expected: v.total_expected,
    total_verified: v.total_verified,
    changes_count: v.changes_count,
    candidates_count: v.candidates_count,
    active_keywords_count: v.active_keywords_count,
    searches_executed: v.searches_executed,
    sources_text: v.sources_text,
    snapshot: JSON.stringify(report)
  });

  return report;
}

async function getReports() {
  return (await allRows("reports"))
    .sort(function(a, b) {
      return String(b.emitted_at || "").localeCompare(String(a.emitted_at || ""));
    })
    .slice(0, 100)
    .map(function(r) {
      return {
        id: r.id,
        verificationId: r.verification_id,
        data: r.report_date,
        responsavel: r.responsible,
        inicio: r.started_at,
        fimTecnico: r.technical_finished_at,
        emissao: r.emitted_at,
        status: r.status,
        observacao: r.observation,
        totalPrevisto: r.total_expected,
        totalVerificado: r.total_verified,
        alteracoes: r.changes_count,
        candidatas: r.candidates_count,
        palavrasAtivas: r.active_keywords_count,
        buscasExecutadas: r.searches_executed,
        fontes: r.sources_text
      };
    });
}

async function getReport(id) {
  const r = await oneRow("reports", id);

  if (!r) throw new Error("Relatório não encontrado.");

  try {
    const snapshot = JSON.parse(String(r.snapshot || "{}"));
    if (snapshot && Object.keys(snapshot).length) {
      return snapshot;
    }
  } catch (_) {}

  return {
    data: r.report_date,
    responsavel: r.responsible,
    inicio: r.started_at,
    fimTecnico: r.technical_finished_at,
    emissao: r.emitted_at,
    status: r.status,
    observacao: r.observation,
    totalPrevisto: r.total_expected,
    totalVerificado: r.total_verified,
    alteracoes: r.changes_count,
    candidatas: r.candidates_count,
    palavrasAtivas: r.active_keywords_count,
    buscasExecutadas: r.searches_executed,
    fontes: r.sources_text,
    detalhes: {},
    buscasManuais: []
  };
}

async function handle(fn, args) {
  if (fn === "login") {
    return login(args[0]);
  }

  const token = String(args[0] || "");
  await validateSession(token);

  switch (fn) {
    case "getDashboard":
      return getDashboard();

    case "getProposituras":
      return getPropositions();

    case "getAlteracoes":
      return getAlterations();

    case "setAlteracaoStatus": {
      const status = String(args[2] || "");

      if (!["Pendente", "Confirmada", "Ignorada"].includes(status)) {
        throw new Error("Status inválido.");
      }

      await updateRow("alterations", String(args[1]), {
        status,
        analyzed_at: status === "Pendente" ? null : now()
      });

      return getAlterations();
    }

    case "reverterAlteracao":
      await updateRow("alterations", String(args[1]), {
        status: "Pendente",
        analyzed_at: null
      });
      return getAlterations();

    case "getCandidatasPendentes":
      return getCandidates();

    case "registrarCandidataManual":
      return registerCandidate(
        String(args[1] || ""),
        String(args[2] || ""),
        args[3] || {}
      );

    case "atualizarCandidata":
      return editCandidate(String(args[1]), args[2] || {});

    case "validarCandidataParaAprovacao":
      return validateCandidate(String(args[1]));

    case "aprovarCandidata":
      return approveCandidate(String(args[1]));

    case "ignorarCandidata":
      await updateRow("candidates", String(args[1]), {
        status: "Ignorada",
        decision_at: now()
      });
      return { ok: true };

    case "iniciarVerificacao":
      return startVerification(String(args[1] || ""));

    case "getVerificacaoAtual":
      return getVerification(String(args[1]));

    case "concluirVerificacaoTecnica":
      return saveVerification(String(args[1]), args[2] || {});

    case "verificarCamara":
      return verifyCamara(String(args[1]));

    case "verificarSenado":
      return verifySenado(String(args[1]));

    case "verificarAlesp":
      return verifyAlesp(String(args[1]));

    case "reverificarFonte": {
      const verificationId = String(args[1]);
      const fonte = String(args[2]);

      let fresh;

      if (fonte === "Câmara") {
        fresh = await verifyCamara(verificationId);
      } else if (fonte === "Senado") {
        fresh = await verifySenado(verificationId);
      } else if (fonte === "ALESP") {
        fresh = await verifyAlesp(verificationId);
      } else {
        throw new Error("Casa legislativa inválida.");
      }

      const v = await oneRow("verifications", verificationId);
      const existing = v && v.details || {};
      const results = (existing.resultados || []).filter(function(r) {
        return r.fonte !== fonte;
      });

      results.push(fresh);

      const resumo = {
        completa:
          results.length === 3 &&
          results.every(function(r) {
            return Number(r.erros || 0) === 0 &&
              Number(r.verificado || 0) === Number(r.previsto || 0);
          }),
        totalPrevisto: results.reduce(function(a, r) {
          return a + Number(r.previsto || 0);
        }, 0),
        totalVerificado: results.reduce(function(a, r) {
          return a + Number(r.verificado || 0);
        }, 0),
        alteracoes: results.reduce(function(a, r) {
          return a + Number(r.alteracoes || 0);
        }, 0),
        candidatas: Number(existing.candidatas || 0),
        palavras: Number(existing.palavras || 0),
        buscas: Number(existing.buscas || 0),
        fontes: "Câmara, Senado, ALESP",
        resultados: results
      };

      await saveVerification(verificationId, resumo);
      return resumo;
    }

    case "getPesquisaDiaria":
      return searchPage();

    case "buscarNovasPropositurasAutomatica":
      return runAutomaticSearch(
        String(args[1] || ""),
        String(args[2] || ""),
        String(args[3] || "")
      );

    case "getResultadosPesquisaAutomatica":
      return getAutomaticSearchResults(String(args[1] || ""), String(args[2] || ""));

    case "adicionarResultadoPesquisaAutomatica":
      return promoteAutomaticSearchResult(String(args[1] || ""), String(args[2] || ""), String(args[3] || ""));

    case "ignorarResultadoPesquisaAutomatica":
      return ignoreAutomaticSearchResult(String(args[1] || ""));

    case "addTermoPesquisa": {
      const term = clean(args[1]);
      if (!term) throw new Error("Informe o termo de pesquisa.");

      await insertRow("keywords", {
        term,
        label: term,
        weight: Number(args[2] || 5),
        active: true,
        active_legacy: true
      });

      return searchPage();
    }

    case "removerTermoPesquisa":
      await updateRow("keywords", String(args[1]), {
        active: false,
        active_legacy: false
      });
      return searchPage();

    case "getBuscaGuiada":
      return guidedSearch(String(args[1]));

    case "salvarBuscaManual":
      return saveManualSearch(
        String(args[1]),
        String(args[2] || ""),
        String(args[3] || ""),
        Number(args[4] || 0)
      );

    case "reabrirBuscaManual": {
      const verificationId = String(args[1]);
      const fonte = String(args[2]);
      const code = sourceCode(fonte);

      const existing = (await allRows("manual_searches")).find(function(r) {
        return String(r.verification_id || "") === verificationId &&
          r.source_code === code;
      });

      if (existing) {
        await updateRow("manual_searches", existing.id, {
          status: "Pendente",
          search_time: now()
        });
      }

      return guidedSearch(verificationId);
    }

    case "prepararRelatorio":
      return prepareReport(String(args[1]));

    case "salvarRelatorio":
      return saveReport(String(args[1]), String(args[2] || ""));

    case "getRelatorios":
      return getReports();

    case "getRelatorioSalvo":
      return getReport(String(args[1]));

    case "getPalavras":
      return activeKeywords();

    case "addPalavra": {
      const term = clean(args[1]);
      if (!term) throw new Error("Informe a palavra-chave.");

      await insertRow("keywords", {
        term,
        label: term,
        weight: Number(args[2] || 5),
        active: true,
        active_legacy: true
      });

      return activeKeywords();
    }

    case "togglePalavra":
      await updateRow("keywords", String(args[1]), {
        active: Boolean(args[2]),
        active_legacy: Boolean(args[2])
      });
      return activeKeywords();

    case "getConfiguracoes":
      return { ok: true, senhaConfigurada: true };

    case "alterarSenhaAcesso": {
      const current = String(args[1] || "");
      const next = String(args[2] || "");
      const confirm = String(args[3] || "");

      const setting = await oneRow("app_settings", "1");

      if (!setting) throw new Error("Configuração de acesso não encontrada.");

      if (
        await passwordHash(current, setting.password_salt) !==
        setting.password_hash
      ) {
        throw new Error("A senha atual está incorreta.");
      }

      if (next.length < 6) {
        throw new Error("A nova senha deve ter pelo menos 6 caracteres.");
      }

      if (next !== confirm) {
        throw new Error("A confirmação da nova senha não confere.");
      }

      if (next === current) {
        throw new Error("A nova senha deve ser diferente da senha atual.");
      }

      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const salt = btoa(String.fromCharCode(...saltBytes));
      const hash = await passwordHash(next, salt);

      await updateRow("app_settings", "1", {
        password_hash: hash,
        password_salt: salt,
        auth_version: Number(setting.auth_version || 1) + 1,
        updated_at: now()
      });

      return {
        ok: true,
        message: "Senha alterada. Entre novamente com a nova senha."
      };
    }

    case "atualizarRegimesAlesp":
      return {
        ok: false,
        status: "PENDENTE",
        message: "A atualização de regimes ALESP será executada pelo job da nova plataforma."
      };

    case "getStatusAtualizacaoRegimesAlesp":
      return {
        ok: true,
        status: "NÃO CONFIGURADO"
      };

    default:
      throw new Error("Função não suportada: " + fn);
  }
}

Deno.serve(async function(request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const payload = await request.json();
    const fn = String(payload.fn || "");
    const args = Array.isArray(payload.args) ? payload.args : [];
    const result = await handle(fn, args);

    return out({ ok: true, data: result }, 200);
  } catch (error) {
    return out(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      },
      400
    );
  }
});
