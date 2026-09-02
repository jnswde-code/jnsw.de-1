"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Plus, X, ChevronDown, Search, Save, Trash2, RotateCcw,
  FolderOpen, Layers, CircleAlert, Check, SlidersHorizontal, Code2,
  Bell, HelpCircle, Camera,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { StreamLanguage } from "@codemirror/language";
import { autocompletion } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";

/* ------------------------------------------------------------------ *
 *  FELD-DEFINITIONEN
 *  (repräsentativer Ausschnitt aus den ~170 im Original beobachteten
 *  Feldern, gruppiert nach fachlicher Kategorie statt einer flachen,
 *  ungruppierten Liste ohne Suche)
 * ------------------------------------------------------------------ */
const FIELD_GROUPS = [
  {
    label: "Identifikation",
    fields: [
      { key: "auf_id", label: "Auf.ID", type: "text" },
      { key: "vorg_id", label: "Vorg.ID", type: "text" },
      { key: "abr_id", label: "Abr. ID", type: "text" },
      { key: "kunde", label: "Kunde", type: "text" },
      { key: "kunde_extid", label: "Kunde Externe ID", type: "text" },
    ],
  },
  {
    label: "Termine",
    fields: [
      { key: "erstelldatum", label: "Erstelldatum", type: "date" },
      { key: "aenderungsdatum", label: "Änderungsdatum", type: "date" },
      { key: "geburtsdatum", label: "Geburtsdatum", type: "date" },
      { key: "servicedatum", label: "Servicedatum", type: "date" },
      { key: "genehmigt_am", label: "Genehmigt am", type: "date" },
      { key: "rezeptdatum", label: "Rezeptdatum", type: "date" },
    ],
  },
  {
    label: "Adressen",
    fields: [
      { key: "lieferadresse", label: "Lieferung Adresse", type: "text" },
      { key: "rechnungadresse", label: "Rechnung Adresse", type: "text" },
      { key: "hauptadresse", label: "Haupt Adresse", type: "text" },
      { key: "kunde_ort", label: "Kunde Ort", type: "text" },
    ],
  },
  {
    label: "Zuständigkeit",
    fields: [
      { key: "ad_ma", label: "AD-MA", type: "text" },
      { key: "ad_gr", label: "AD-GR", type: "text" },
      { key: "id_ma", label: "ID-MA", type: "text" },
      { key: "erstellt_von", label: "Erstellt von", type: "text" },
      { key: "geaendert_von", label: "Geändert von", type: "text" },
      { key: "vermittler", label: "Vermittler", type: "text" },
    ],
  },
  {
    label: "Kostenträger",
    fields: [
      { key: "kostentraeger", label: "Kostenträger", type: "text" },
      {
        key: "kostentraegerart", label: "Kostenträgerart", type: "select",
        options: ["GKV", "PKV", "Privat", "Berufsgenossenschaft"],
      },
      { key: "kt_ik", label: "KT IK Nummer", type: "text" },
      { key: "filiale", label: "Filiale", type: "select", options: ["CaseFlow", "Filiale 1", "Standort Nord", "Testfiliale"] },
    ],
  },
  {
    label: "Preise (Netto)",
    fields: [
      { key: "ek_netto", label: "EK Netto", type: "currency" },
      { key: "gkv_netto", label: "GKV Netto", type: "currency" },
      { key: "kt_netto", label: "KT Netto", type: "currency" },
      { key: "vk_netto", label: "VK Netto", type: "currency" },
      { key: "preis_summe_netto", label: "Preis Summe Netto", type: "currency" },
    ],
  },
  {
    label: "Preise (Brutto)",
    fields: [
      { key: "gkv_brutto", label: "GKV Brutto", type: "currency" },
      { key: "kt_brutto", label: "KT Brutto", type: "currency" },
      { key: "vk_brutto", label: "VK Brutto", type: "currency" },
      { key: "preis_summe_brutto", label: "Preis Summe Brutto", type: "currency" },
    ],
  },
  {
    label: "Abrechnungsstatus",
    fields: [
      { key: "vollstaendig_berechnet", label: "Vollständig berechnet", type: "boolean" },
      { key: "storniert", label: "Storniert", type: "boolean" },
      { key: "bezahlt_vk_brutto", label: "Bezahlt VK Brutto", type: "currency" },
    ],
  },
  {
    label: "Genehmigung / Verordnung",
    fields: [
      { key: "kv_erforderlich", label: "KV erforderlich", type: "boolean" },
      { key: "genehmigungsnummer", label: "Genehmigungsnummer", type: "text" },
      { key: "abgelehnt", label: "Abgelehnt", type: "boolean" },
      { key: "lanr", label: "LANR", type: "text" },
      { key: "arztname", label: "Arztname", type: "text" },
    ],
  },
  {
    label: "Lieferung",
    fields: [
      { key: "liefermethode", label: "Liefermethode", type: "select", options: ["Versand", "Abholung", "Botendienst", "Direktmitnahme"] },
      { key: "prioritaet", label: "Priorität", type: "select", options: ["Niedrig", "Normal", "Hoch", "Dringend"] },
      { key: "vollstaendig_geliefert", label: "Vollständig geliefert", type: "boolean" },
    ],
  },
];

const ALL_FIELDS = FIELD_GROUPS.flatMap((g) => g.fields.map((f) => ({ ...f, group: g.label })));
const FIELD_BY_KEY = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f]));
// längste Feldnamen zuerst, damit z. B. "Preis Summe Netto" vor "Preis" gematcht wird
const ALL_FIELDS_SORTED = [...ALL_FIELDS].sort((a, b) => b.label.length - a.label.length);

const OPERATORS = {
  text: ["enthält", "enthält nicht", "ist gleich", "ist leer", "ist nicht leer"],
  number: ["=", "≠", ">", "<", "≥", "≤", "zwischen"],
  currency: ["=", "≠", ">", "<", "≥", "≤", "zwischen"],
  date: ["ist am", "vor", "nach", "zwischen"],
  select: ["ist", "ist nicht"],
  boolean: ["ist"],
};
// ASCII-Alternativen, falls Sonderzeichen nicht leicht tippbar sind
const OPERATOR_ALIASES = { ">=": "≥", "<=": "≤", "!=": "≠", "<>": "≠" };
// Natürliche Formulierungen, die im Text-Modus dasselbe wie "ist am" bedeuten
// (passend zur granularitätsabhängigen Anzeige im Builder)
const DATE_OPERATOR_ALIASES = { "ist im jahr": "ist am", "ist im": "ist am" };

const uid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------------ *
 *  Strenge Eingabe-Beschränkungen für numerische Felder.
 *  type="number" allein reicht nicht: Browser lassen dort weiterhin
 *  "e", "+", mehrere Punkte etc. zu. Wir blockieren ungültige Zeichen
 *  daher direkt beim Tastendruck (keydown) UND bereinigen zusätzlich
 *  den Wert bei Paste/Autofill (onChange) als zweite Absicherung.
 * ------------------------------------------------------------------ */
const NAV_KEYS = ["Backspace", "Delete", "Tab", "Escape", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
function numericKeyDown(e, { allowDecimal = false, allowNegative = false } = {}) {
  if (NAV_KEYS.includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[0-9]$/.test(e.key)) return;
  if (allowDecimal && (e.key === "." || e.key === ",")) return;
  if (allowNegative && e.key === "-" && e.currentTarget.selectionStart === 0 && !e.currentTarget.value.includes("-")) return;
  e.preventDefault();
}
function sanitizeInteger(raw, maxLen) {
  const digits = (raw || "").replace(/[^0-9]/g, "");
  return maxLen ? digits.slice(0, maxLen) : digits;
}
function sanitizeDecimal(raw, allowNegative = true) {
  let s = raw || "";
  const neg = allowNegative && s.trim().startsWith("-");
  let out = neg ? "-" : "";
  let hasSep = false;
  for (const ch of s) {
    if (/[0-9]/.test(ch)) out += ch;
    else if ((ch === "." || ch === ",") && !hasSep) { out += "."; hasSep = true; }
  }
  return out;
}

const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

// Granularität wird direkt am Format des gespeicherten Werts erkannt:
// "2026" = Jahr, "2026-05" = Monat, "2026-05-14" = Tag. So bleibt die
// Text-/Abfrage-Syntax simpel (kein zusätzliches Schlüsselwort nötig)
// und Builder + Textansicht sind automatisch konsistent.
function dateGranularity(val) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(val || "")) return "tag";
  if (/^\d{4}-\d{2}$/.test(val || "")) return "monat";
  if (/^\d{4}$/.test(val || "")) return "jahr";
  return "tag";
}
function convertDateValue(val, toGran) {
  if (!val) return "";
  const [y, m, d] = val.split("-");
  if (!y) return "";
  if (toGran === "jahr") return y;
  if (toGran === "monat") return `${y}-${m || "01"}`;
  return `${y}-${m || "01"}-${d || "01"}`;
}
function formatDateDisplay(val, gran) {
  if (!val) return "…";
  if (gran === "jahr") return val;
  if (gran === "monat") {
    const [y, m] = val.split("-");
    return `${MONTH_NAMES[(parseInt(m, 10) || 1) - 1]} ${y}`;
  }
  const [y, m, d] = val.split("-");
  if (!y || !m || !d) return val;
  return `${d}.${m}.${y}`;
}
// Operator-Beschriftung passt sich der Granularität an ("ist am 14.02.2026"
// vs. "ist im März 2026" vs. "ist im Jahr 2026"), der gespeicherte
// kanonische Operator-Wert bleibt aber für den Parser immer gleich.
function dateOperatorLabel(op, gran) {
  if (op === "ist am") {
    if (gran === "jahr") return "ist im Jahr";
    if (gran === "monat") return "ist im";
    return "ist am";
  }
  return op;
}
function getOperatorOptions(field, granularity) {
  if (!field) return [];
  const base = OPERATORS[field.type] || [];
  if (field.type !== "date") return base.map((op) => ({ value: op, label: op }));
  return base.map((op) => ({ value: op, label: dateOperatorLabel(op, granularity || "tag") }));
}

const newRule = () => ({ id: uid(), kind: "rule", field: "", operator: "", value: "", value2: "", granularity: "tag" });
const newGroup = () => ({ id: uid(), kind: "group", logic: "UND", children: [newRule()] });

/* ------------------------------------------------------------------ *
 *  TREE HELPERS (immutable)
 * ------------------------------------------------------------------ */
function updateNode(node, id, patch) {
  if (node.id === id) return { ...node, ...patch };
  if (node.kind === "group") return { ...node, children: node.children.map((c) => updateNode(c, id, patch)) };
  return node;
}
function removeNode(node, id) {
  if (node.kind !== "group") return node;
  return { ...node, children: node.children.filter((c) => c.id !== id).map((c) => removeNode(c, id)) };
}
function addChild(node, groupId, child) {
  if (node.id === groupId && node.kind === "group") return { ...node, children: [...node.children, child] };
  if (node.kind === "group") return { ...node, children: node.children.map((c) => addChild(c, groupId, child)) };
  return node;
}
function countRules(node) {
  if (node.kind === "rule") return node.field ? 1 : 0;
  return node.children.reduce((sum, c) => sum + countRules(c), 0);
}
function isComplete(node) {
  if (node.kind === "rule") {
    if (!node.field || !node.operator) return false;
    if (["ist leer", "ist nicht leer"].includes(node.operator)) return true;
    if (node.operator === "zwischen") return node.value !== "" && node.value2 !== "";
    return node.value !== "";
  }
  return node.children.every(isComplete);
}
function formatValue(field, operator, value, value2) {
  if (["ist leer", "ist nicht leer"].includes(operator)) return "";
  if (operator === "zwischen") return `${value || "…"} und ${value2 || "…"}`;
  if (field?.type === "currency" && value !== "") return `${value} €`;
  return value || "…";
}
/* ------------------------------------------------------------------ *
 *  Auswertung des Filterbaums gegen eine Datenzeile – macht den
 *  "Suchen"-Button tatsaechlich funktional statt nur die Vorschau zu
 *  aktualisieren.
 * ------------------------------------------------------------------ */
function evaluateRule(rule, row) {
  const field = FIELD_BY_KEY[rule.field];
  if (!field || !rule.operator) return true; // unvollstaendige Bedingung filtert nicht aus
  const raw = row[rule.field];

  if (rule.operator === "ist leer") return raw === undefined || raw === null || raw === "";
  if (rule.operator === "ist nicht leer") return !(raw === undefined || raw === null || raw === "");

  if (field.type === "text") {
    const val = (raw ?? "").toString().toLowerCase();
    const cmp = (rule.value || "").toLowerCase();
    if (rule.operator === "enthält") return val.includes(cmp);
    if (rule.operator === "enthält nicht") return !val.includes(cmp);
    if (rule.operator === "ist gleich") return val === cmp;
  }
  if (field.type === "number" || field.type === "currency") {
    const num = parseFloat(raw);
    if (Number.isNaN(num)) return false;
    const v1 = parseFloat(rule.value);
    if (rule.operator === "zwischen") {
      const v2 = parseFloat(rule.value2);
      if (Number.isNaN(v1) || Number.isNaN(v2)) return true;
      return num >= Math.min(v1, v2) && num <= Math.max(v1, v2);
    }
    if (Number.isNaN(v1)) return true;
    if (rule.operator === "=") return num === v1;
    if (rule.operator === "≠") return num !== v1;
    if (rule.operator === ">") return num > v1;
    if (rule.operator === "<") return num < v1;
    if (rule.operator === "≥") return num >= v1;
    if (rule.operator === "≤") return num <= v1;
  }
  if (field.type === "date") {
    if (!raw) return false;
    const gran = rule.granularity || "tag";
    const rowVal = convertDateValue(raw, gran);
    if (rule.operator === "zwischen") {
      if (!rule.value || !rule.value2) return true;
      return rowVal >= rule.value && rowVal <= rule.value2;
    }
    if (!rule.value) return true;
    if (rule.operator === "ist am") return rowVal === rule.value;
    if (rule.operator === "vor") return rowVal < rule.value;
    if (rule.operator === "nach") return rowVal > rule.value;
  }
  if (field.type === "select") {
    if (rule.operator === "ist") return (raw || "") === rule.value;
    if (rule.operator === "ist nicht") return (raw || "") !== rule.value;
  }
  if (field.type === "boolean") {
    const boolVal = raw ? "Ja" : "Nein";
    if (rule.operator === "ist") return boolVal === rule.value;
  }
  return true;
}
function evaluateTree(node, row) {
  if (node.kind === "rule") {
    if (!isComplete(node)) return true;
    return evaluateRule(node, row);
  }
  if (node.children.length === 0) return true;
  const results = node.children.map((c) => evaluateTree(c, row));
  return node.logic === "UND" ? results.every(Boolean) : results.some(Boolean);
}

function describe(node) {
  if (node.kind === "rule") {
    const field = FIELD_BY_KEY[node.field];
    if (!field) return "(leere Bedingung)";
    if (!node.operator) return `${field.label} …`;
    if (field.type === "date") {
      const gran = node.granularity || "tag";
      const opLabel = dateOperatorLabel(node.operator, gran);
      if (node.operator === "zwischen") {
        return `${field.label} ${opLabel} ${formatDateDisplay(node.value, gran)} und ${formatDateDisplay(node.value2, gran)}`;
      }
      return `${field.label} ${opLabel} ${formatDateDisplay(node.value, gran)}`;
    }
    return `${field.label} ${node.operator} ${formatValue(field, node.operator, node.value, node.value2)}`.trim();
  }
  if (node.children.length === 0) return "";
  const parts = node.children.map(describe);
  const joined = parts.join(` ${node.logic} `);
  return node.children.length > 1 ? `(${joined})` : joined;
}

/* ------------------------------------------------------------------ *
 *  QUERY-TEXT: parseierbare Repräsentation (mit Anführungszeichen für
 *  Text-Werte, ⟨Platzhalter⟩ für Unvollständiges)
 * ------------------------------------------------------------------ */
function valueLiteral(field, val) {
  if (!field) return val || "";
  if (field.type === "text") return `"${(val || "").replace(/"/g, '\\"')}"`;
  return val || "";
}
function nodeToQueryText(node) {
  if (node.kind === "rule") {
    const field = FIELD_BY_KEY[node.field];
    if (!field) return "⟨Feld wählen⟩";
    if (!node.operator) return field.label;
    if (["ist leer", "ist nicht leer"].includes(node.operator)) return `${field.label} ${node.operator}`;
    if (node.operator === "zwischen") {
      const v1 = node.value ? valueLiteral(field, node.value) : "⟨Wert⟩";
      const v2 = node.value2 ? valueLiteral(field, node.value2) : "⟨Wert⟩";
      return `${field.label} zwischen ${v1} und ${v2}`;
    }
    const v1 = node.value ? valueLiteral(field, node.value) : "⟨Wert⟩";
    return `${field.label} ${node.operator} ${v1}`;
  }
  if (node.children.length === 0) return "";
  const parts = node.children.map((c) => {
    const inner = nodeToQueryText(c);
    return c.kind === "group" && c.children.length > 0 ? `(${inner})` : inner;
  });
  return parts.join(` ${node.logic} `);
}

/* ------------------------------------------------------------------ *
 *  PARSER: Text → Baum
 *  Regel: auf derselben Ebene darf UND/ODER nicht gemischt werden –
 *  das erzwingt genau die Klammerung, die im Original fehlte.
 * ------------------------------------------------------------------ */
class ParseError extends Error {
  constructor(message, index) {
    super(message);
    this.index = index;
  }
}
function isWordChar(ch) {
  return ch !== undefined && /[A-Za-z0-9äöüÄÖÜß_.\-]/.test(ch);
}
function skipWs(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}
function matchKeyword(s, i, word) {
  if (s.slice(i, i + word.length).toLowerCase() === word.toLowerCase()) {
    const end = i + word.length;
    if (!isWordChar(s[end])) return end;
  }
  return null;
}
function matchLongestField(s, i) {
  const rest = s.slice(i).toLowerCase();
  for (const f of ALL_FIELDS_SORTED) {
    if (rest.startsWith(f.label.toLowerCase())) {
      const end = i + f.label.length;
      if (!isWordChar(s[end])) return { field: f, i: end };
    }
  }
  return null;
}
function matchLongestOperator(s, i, type) {
  const ops = OPERATORS[type] || [];
  const candidates = ops.map((op) => ({ text: op, canonical: op }));
  Object.entries(OPERATOR_ALIASES).forEach(([alias, canonical]) => {
    if (ops.includes(canonical)) candidates.push({ text: alias, canonical });
  });
  Object.entries(DATE_OPERATOR_ALIASES).forEach(([alias, canonical]) => {
    if (ops.includes(canonical)) candidates.push({ text: alias, canonical });
  });
  candidates.sort((a, b) => b.text.length - a.text.length);
  const rest = s.slice(i);
  for (const c of candidates) {
    if (rest.toLowerCase().startsWith(c.text.toLowerCase())) {
      const end = i + c.text.length;
      const isSymbol = /^[<>=≥≤≠!]+$/.test(c.text);
      if (isSymbol || !isWordChar(s[end])) return { op: c.canonical, i: end };
    }
  }
  return null;
}
function parseValue(s, i, field) {
  i = skipWs(s, i);
  if (s[i] === '"') {
    let j = i + 1, out = "";
    while (j < s.length && s[j] !== '"') {
      if (s[j] === "\\" && s[j + 1] === '"') { out += '"'; j += 2; }
      else { out += s[j]; j++; }
    }
    if (s[j] !== '"') throw new ParseError('Schließendes " fehlt', j);
    return { val: out, i: j + 1 };
  }
  if (field.type === "date") {
    const rest = s.slice(i);
    let m = /^\d{4}-\d{2}-\d{2}/.exec(rest) || /^\d{4}-\d{2}/.exec(rest) || /^\d{4}/.exec(rest);
    if (!m) throw new ParseError(`Datum erwartet für "${field.label}" (JJJJ, JJJJ-MM oder JJJJ-MM-TT)`, i);
    const end = i + m[0].length;
    if (/\d/.test(s[end] || "")) throw new ParseError(`Ungültiges Datumsformat für "${field.label}"`, i);
    return { val: m[0], i: end };
  }
  if (field.type === "number" || field.type === "currency") {
    const m = /^-?\d+([.,]\d+)?/.exec(s.slice(i));
    if (!m) throw new ParseError(`Zahl erwartet für "${field.label}"`, i);
    let j = i + m[0].length;
    const eur = /^\s*€/.exec(s.slice(j));
    if (eur) j += eur[0].length;
    return { val: m[0].replace(",", "."), i: j };
  }
  if (field.type === "select" || field.type === "boolean") {
    const m = /^[^\s()]+/.exec(s.slice(i));
    if (!m) throw new ParseError(`Wert erwartet für "${field.label}"`, i);
    return { val: m[0], i: i + m[0].length };
  }
  throw new ParseError(`Textwert für "${field.label}" muss in Anführungszeichen stehen, z. B. "Wert"`, i);
}
function parseCondition(s, i) {
  i = skipWs(s, i);
  const fm = matchLongestField(s, i);
  if (!fm) throw new ParseError("Unbekanntes Feld an dieser Position", i);
  i = skipWs(s, fm.i);
  const om = matchLongestOperator(s, i, fm.field.type);
  if (!om) throw new ParseError(`Unbekannter Operator für Feld "${fm.field.label}"`, i);
  i = skipWs(s, om.i);
  const operator = om.op;
  let value = "", value2 = "";
  if (!["ist leer", "ist nicht leer"].includes(operator)) {
    if (operator === "zwischen") {
      const v1 = parseValue(s, i, fm.field); i = v1.i;
      i = skipWs(s, i);
      const undI = matchKeyword(s, i, "und");
      if (undI == null) throw new ParseError('"und" erwartet, z. B. "zwischen 1 und 10"', i);
      i = skipWs(s, undI);
      const v2 = parseValue(s, i, fm.field); i = v2.i;
      value = v1.val; value2 = v2.val;
    } else {
      const v1 = parseValue(s, i, fm.field); i = v1.i;
      value = v1.val;
    }
  }
  const granularity = fm.field.type === "date" ? dateGranularity(value || value2 || "") : undefined;
  return { node: { kind: "rule", id: uid(), field: fm.field.key, operator, value, value2, granularity }, i };
}
function parsePrimary(s, i) {
  i = skipWs(s, i);
  if (s[i] === "(") {
    const inner = parseLevel(s, i + 1);
    const j = skipWs(s, inner.i);
    if (s[j] !== ")") throw new ParseError('Schließende Klammer ")" erwartet', j);
    return { node: inner.node, i: j + 1 };
  }
  return parseCondition(s, i);
}
function parseLevel(s, i) {
  i = skipWs(s, i);
  const first = parsePrimary(s, i);
  const children = [first.node];
  i = first.i;
  let logic = null;
  while (true) {
    const j = skipWs(s, i);
    const u = matchKeyword(s, j, "UND");
    const o = matchKeyword(s, j, "ODER");
    let matchedEnd = null, kind = null;
    if (u != null) { matchedEnd = u; kind = "UND"; }
    else if (o != null) { matchedEnd = o; kind = "ODER"; }
    else break;
    if (logic === null) logic = kind;
    else if (logic !== kind) {
      throw new ParseError("UND und ODER können nicht auf derselben Ebene gemischt werden – bitte Klammern verwenden", j);
    }
    i = skipWs(s, matchedEnd);
    const nxt = parsePrimary(s, i);
    children.push(nxt.node);
    i = nxt.i;
  }
  if (children.length === 1) return { node: children[0], i };
  return { node: { kind: "group", id: uid(), logic: logic || "UND", children }, i };
}
function normalizeTree(node) {
  if (node.kind === "rule") {
    const field = FIELD_BY_KEY[node.field];
    if (field?.type === "date" && node.operator === "zwischen") {
      const gran = node.granularity || dateGranularity(node.value);
      return { ...node, granularity: gran, value: convertDateValue(node.value, gran), value2: convertDateValue(node.value2, gran) };
    }
    return node;
  }
  return { ...node, children: node.children.map(normalizeTree) };
}
function parseQuery(text) {
  const s = text.trim();
  if (!s) return { kind: "group", id: uid(), logic: "UND", children: [] };
  const result = parseLevel(s, 0);
  const end = skipWs(s, result.i);
  if (end !== s.length) throw new ParseError("Unerwarteter Text am Ende der Abfrage", end);
  let node = result.node;
  if (node.kind === "rule") node = { kind: "group", id: uid(), logic: "UND", children: [node] };
  return node;
}

/* ------------------------------------------------------------------ *
 *  Click-away hook
 * ------------------------------------------------------------------ */
function useClickAway(onAway) {
  const ref = useRef(null);
  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) onAway(); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onAway]);
  return ref;
}

/* ------------------------------------------------------------------ *
 *  Field picker: durchsuchbar + kategorisiert
 * ------------------------------------------------------------------ */
function FieldPicker({ value, onChange, placeholder = "Feld wählen…" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useClickAway(() => setOpen(false));
  const selected = FIELD_BY_KEY[value];

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FIELD_GROUPS.map((g) => ({ ...g, fields: g.fields.filter((f) => f.label.toLowerCase().includes(q)) }))
      .filter((g) => g.fields.length > 0);
  }, [query]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-800 hover:border-slate-400 min-w-[168px] justify-between"
      >
        <span className={selected ? "" : "text-slate-400 font-normal"}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-2">
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Feld suchen…"
              className="w-full text-sm outline-none placeholder:text-slate-400" />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filteredGroups.length === 0 && <div className="px-3 py-3 text-sm text-slate-400">Keine Felder gefunden.</div>}
            {filteredGroups.map((g) => (
              <div key={g.label} className="py-1">
                <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</div>
                {g.fields.map((f) => (
                  <button key={f.key} type="button"
                    onClick={() => { onChange(f); setOpen(false); setQuery(""); }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-orange-50 ${f.key === value ? "bg-orange-50 text-orange-700 font-medium" : "text-slate-700"}`}>
                    {f.label}
                    {f.key === value && <Check className="h-3.5 w-3.5" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Value input – abhängig vom Feldtyp/Operator
 * ------------------------------------------------------------------ */
function ValueInput({ field, operator, value, value2, granularity, onChange }) {
  if (!field || !operator) return <div className="text-sm text-slate-300 italic px-1">Feld & Operator wählen</div>;
  if (["ist leer", "ist nicht leer"].includes(operator)) return null;
  const common = "rounded-md border border-slate-300 px-2.5 py-1.5 text-sm w-36 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-300";

  if (field.type === "date") {
    const gran = granularity || "tag";
    const setGran = (g) => onChange({ granularity: g, value: convertDateValue(value, g), value2: convertDateValue(value2, g) });
    const dateInput = (val, key) => {
      if (gran === "jahr") {
        return (
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            placeholder="JJJJ"
            value={val}
            onKeyDown={(e) => numericKeyDown(e, { allowDecimal: false, allowNegative: false })}
            onChange={(e) => onChange({ [key]: sanitizeInteger(e.target.value, 4) })}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n)) onChange({ [key]: String(Math.min(2100, Math.max(1900, n))) });
            }}
            className={common + " w-24"}
          />
        );
      }
      if (gran === "monat") return <input type="month" value={val} onChange={(e) => onChange({ [key]: e.target.value })} className={common + " w-40"} />;
      return <input type="date" value={val} onChange={(e) => onChange({ [key]: e.target.value })} className={common + " w-40"} />;
    };
    const granSwitch = (
      <div className="flex overflow-hidden rounded-md border border-slate-300 text-xs" role="group" aria-label="Datumsgranularität">
        {[["tag", "Tag"], ["monat", "Monat"], ["jahr", "Jahr"]].map(([g, label]) => (
          <button key={g} type="button" onClick={() => setGran(g)} aria-pressed={gran === g}
            className={`px-2 py-1 font-medium ${gran === g ? "bg-orange-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
      </div>
    );
    return (
      <div className="flex flex-wrap items-center gap-2">
        {granSwitch}
        {dateInput(value, "value")}
        {operator === "zwischen" && (
          <>
            <span className="text-xs text-slate-400">und</span>
            {dateInput(value2, "value2")}
          </>
        )}
      </div>
    );
  }

  const single = (val, key) => {
    if (field.type === "number" || field.type === "currency") {
      return (
        <div className="relative">
          <input
            type="text"
            inputMode="decimal"
            value={val}
            onKeyDown={(e) => numericKeyDown(e, { allowDecimal: true, allowNegative: true })}
            onChange={(e) => onChange({ [key]: sanitizeDecimal(e.target.value, true) })}
            className={common + (field.type === "currency" ? " pr-6" : "")}
          />
          {field.type === "currency" && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span>}
        </div>
      );
    }
    if (field.type === "select") {
      return (
        <select value={val} onChange={(e) => onChange({ [key]: e.target.value })} className={common}>
          <option value="">Wählen…</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (field.type === "boolean") {
      return (
        <select value={val} onChange={(e) => onChange({ [key]: e.target.value })} className={common}>
          <option value="">Wählen…</option>
          <option value="Ja">Ja</option>
          <option value="Nein">Nein</option>
        </select>
      );
    }
    return <input type="text" value={val} onChange={(e) => onChange({ [key]: e.target.value })} className={common} placeholder="Wert…" />;
  };
  if (operator === "zwischen") {
    return <div className="flex items-center gap-2">{single(value, "value")}<span className="text-xs text-slate-400">und</span>{single(value2, "value2")}</div>;
  }
  return single(value, "value");
}

/* ------------------------------------------------------------------ *
 *  Eine Bedingungs-Zeile
 * ------------------------------------------------------------------ */
function RuleRow({ rule, onChange, onRemove }) {
  const field = FIELD_BY_KEY[rule.field];
  const opList = getOperatorOptions(field, rule.granularity);
  const incomplete = !isComplete(rule);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-white px-2 py-2">
      <FieldPicker value={rule.field} onChange={(f) => onChange({ field: f.key, operator: "", value: "", value2: "", granularity: "tag" })} />
      <select value={rule.operator} onChange={(e) => onChange({ operator: e.target.value, value: "", value2: "" })} disabled={!field}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-300 min-w-[128px]">
        <option value="">Operator…</option>
        {opList.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ValueInput field={field} operator={rule.operator} value={rule.value} value2={rule.value2} granularity={rule.granularity} onChange={onChange} />
      {incomplete && field && rule.operator && (
        <span title="Bedingung ist unvollständig"><CircleAlert className="h-4 w-4 text-amber-500" /></span>
      )}
      <button type="button" onClick={onRemove} aria-label="Bedingung entfernen" title="Bedingung entfernen"
        className="ml-auto rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Gruppe (rekursiv)
 * ------------------------------------------------------------------ */
function Group({ node, depth, onChange, onRemove, isRoot }) {
  const bg = depth % 2 === 0 ? "bg-slate-50" : "bg-white";
  function patchChild(id, patch) { onChange((prev) => updateNode(prev, id, patch)); }
  function removeChild(id) { onChange((prev) => removeNode(prev, id)); }
  function addRuleTo(groupId) { onChange((prev) => addChild(prev, groupId, newRule())); }
  function addGroupTo(groupId) { onChange((prev) => addChild(prev, groupId, newGroup())); }
  function toggleLogic() { onChange((prev) => updateNode(prev, node.id, { logic: node.logic === "UND" ? "ODER" : "UND" })); }
  return (
    <div className={`rounded-lg border ${depth === 0 ? "border-slate-200" : "border-slate-300 border-dashed"} ${bg} p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-xs font-medium text-slate-500">{isRoot ? "Alle folgenden Bedingungen verknüpft mit" : "Untergruppe verknüpft mit"}</span>
          <button type="button" onClick={toggleLogic} disabled={node.children.length < 2}
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors disabled:opacity-40 ${node.logic === "UND" ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-amber-500 text-white hover:bg-amber-400"}`}
            title="Klicken zum Umschalten UND / ODER">
            {node.logic}
          </button>
        </div>
        {!isRoot && (
          <button type="button" onClick={onRemove} aria-label="Gruppe entfernen" title="Gruppe entfernen" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {node.children.map((child, i) => (
          <div key={child.id}>
            {i > 0 && (
              <div className="my-1 flex items-center gap-2 pl-1">
                <span className={`text-[11px] font-semibold ${node.logic === "UND" ? "text-slate-400" : "text-amber-600"}`}>{node.logic}</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            {child.kind === "rule" ? (
              <RuleRow rule={child} onChange={(patch) => patchChild(child.id, patch)} onRemove={() => removeChild(child.id)} />
            ) : (
              <Group node={child} depth={depth + 1} onChange={onChange} onRemove={() => removeChild(child.id)} isRoot={false} />
            )}
          </div>
        ))}
        {node.children.length === 0 && <div className="px-1 py-2 text-sm text-slate-400 italic">Keine Bedingungen. Über die Buttons unten hinzufügen.</div>}
      </div>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={() => addRuleTo(node.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50">
          <Plus className="h-3.5 w-3.5" /> Bedingung
        </button>
        <button type="button" onClick={() => addGroupTo(node.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
          <Plus className="h-3.5 w-3.5" /> Untergruppe
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Abfrage-Textansicht: echter CodeMirror-6-Editor mit eigenem
 *  Language-Mode statt Freitext-<textarea>.
 *
 *  Benoetigte zusaetzliche npm-Pakete (nicht Teil des Claude-Artifact-
 *  Sandbox-Presets, daher fuer eine eigene Vite/CRA/Next-Umgebung):
 *    npm install @uiw/react-codemirror @codemirror/view \
 *      @codemirror/state @codemirror/language @codemirror/autocomplete \
 *      @codemirror/lint
 * ------------------------------------------------------------------ */

// -- Language-Mode: einfacher StreamLanguage-Tokenizer fuer unsere DSL --
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const FIELD_LABELS_BY_LEN = ALL_FIELDS_SORTED.map((f) => f.label);
const ALL_OPERATOR_WORDS = Array.from(
  new Set([
    ...Object.values(OPERATORS).flat(),
    ...Object.keys(OPERATOR_ALIASES),
    ...Object.keys(DATE_OPERATOR_ALIASES),
  ])
).sort((a, b) => b.length - a.length);

const queryStreamParser = {
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match("(") || stream.match(")")) return "bracket";
    if (stream.match(/^"([^"\\]|\\.)*"/)) return "string";
    if (stream.match(/^(UND|ODER)\b/i)) return "keyword";
    if (stream.match(/^und\b/i)) return "keyword";
    for (const label of FIELD_LABELS_BY_LEN) {
      const re = new RegExp("^" + escapeRe(label) + "(?![A-Za-z0-9ÄÖÜäöüß_.-])", "i");
      if (stream.match(re)) return "variableName";
    }
    for (const op of ALL_OPERATOR_WORDS) {
      const isSymbol = /^[<>=≥≤≠!]+$/.test(op);
      const re = isSymbol ? new RegExp("^" + escapeRe(op)) : new RegExp("^" + escapeRe(op) + "(?![A-Za-z0-9ÄÖÜäöüß_.-])", "i");
      if (stream.match(re)) return "operator";
    }
    if (stream.match(/^\d{4}-\d{2}-\d{2}/) || stream.match(/^\d{4}-\d{2}/) || stream.match(/^\d{4}/)) return "number";
    if (stream.match(/^-?\d+([.,]\d+)?/)) return "number";
    stream.next();
    return null;
  },
};
const queryLanguage = StreamLanguage.define(queryStreamParser);

// -- Autocomplete-Source: Feldauswahl per echter CM6-Completion-API,   --
// -- gruppiert nach Kategorie ueber das native "section"-Feature      --
function findSegmentStart(text, pos) {
  const upto = text.slice(0, pos);
  let start = 0;
  const parenIdx = upto.lastIndexOf("(");
  if (parenIdx + 1 > start) start = parenIdx + 1;
  const re = /\b(UND|ODER)\b/gi;
  let m;
  while ((m = re.exec(upto))) {
    const end = m.index + m[0].length;
    if (end > start) start = end;
  }
  return start;
}
function fieldEntryQuery(segment) {
  const lower = segment.toLowerCase();
  for (const f of ALL_FIELDS_SORTED) {
    const fl = f.label.toLowerCase();
    if (lower.startsWith(fl) && lower.length > fl.length) return null;
  }
  return segment;
}
function fieldCompletionSource(context) {
  const text = context.state.doc.toString();
  const segStart = findSegmentStart(text, context.pos);
  const segment = text.slice(segStart, context.pos);
  const leadingWs = segment.match(/^\s*/)[0].length;
  const from = segStart + leadingWs;
  const query = fieldEntryQuery(segment.slice(leadingWs));
  if (query === null || /[()]/.test(query)) return null;
  const q = query.toLowerCase();
  const options = ALL_FIELDS.filter((f) => f.label.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStart = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bStart = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return aStart - bStart || a.label.length - b.label.length;
    })
    .map((f) => ({ label: f.label, type: "variable", section: f.group, apply: f.label + " " }));
  if (options.length === 0) return null;
  return { from, options, validFor: /^[^()]*$/ };
}

// -- Linter: nutzt denselben parseQuery() wie der Rest der App, zeigt --
// -- Syntaxfehler als echte Editor-Unterstreichung + Hover-Tooltip    --
function queryLinter(view) {
  const text = view.state.doc.toString();
  if (!text.trim()) return [];
  const idxPh = text.indexOf("⟨");
  if (idxPh !== -1) {
    return [{ from: idxPh, to: idxPh + 1, severity: "error", message: "Unvollständiger Platzhalter – bitte ersetzen." }];
  }
  try {
    parseQuery(text);
    return [];
  } catch (e) {
    const from = Math.max(0, Math.min(e.index ?? 0, text.length));
    const to = Math.min(from + 1, text.length) === from ? from + 1 : Math.min(from + 1, text.length);
    return [{ from, to: Math.max(to, from + 1), severity: "error", message: e.message }];
  }
}

const queryEditorTheme = EditorView.theme({
  "&": { fontSize: "13px" },
  ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", padding: "8px 10px", minHeight: "96px" },
  "&.cm-focused": { outline: "none" },
  ".cm-variableName": { color: "#c2410c", fontWeight: "600" },
  ".cm-operator": { color: "#334155", fontWeight: "600" },
  ".cm-keyword": { color: "#b45309", fontWeight: "700" },
  ".cm-string": { color: "#15803d" },
  ".cm-number": { color: "#1d4ed8" },
  ".cm-bracket": { color: "#64748b" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontSize: "13px" },
  ".cm-tooltip-lint": { fontSize: "12px", maxWidth: "320px" },
});

/* ------------------------------------------------------------------ *
 *  Abfrage-Textansicht (CodeMirror statt <textarea>)
 * ------------------------------------------------------------------ */
function QueryView({ text, setText, queryError }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Abfrage als Text bearbeiten</span>
        <span className="text-[11px] text-slate-400">Autocomplete: tippen → ↑↓ → Enter/Tab · Fehler werden inline unterstrichen</span>
      </div>
      <div className={`overflow-hidden rounded-md border ${queryError ? "border-red-300" : "border-slate-300 focus-within:border-orange-400 focus-within:ring-1 focus-within:ring-orange-300"}`}>
        <CodeMirror
          value={text}
          height="140px"
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
          theme={queryEditorTheme}
          extensions={[queryLanguage, autocompletion({ override: [fieldCompletionSource] }), linter(queryLinter), EditorView.lineWrapping]}
          onChange={(value) => setText(value)}
        />
      </div>
      {queryError && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span className="font-medium">Beim Anwenden:</span> {queryError.message}
        </div>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        Syntax: <span className="font-mono">Feld Operator Wert</span> · Text in Anführungszeichen <span className="font-mono">"…"</span> ·
        Datum als <span className="font-mono">JJJJ</span> (Jahr), <span className="font-mono">JJJJ-MM</span> (Monat) oder <span className="font-mono">JJJJ-MM-TT</span> (Tag) · Bereich mit <span className="font-mono">zwischen X und Y</span> ·
        Gruppieren mit <span className="font-mono">( )</span> · Verknüpfen mit <span className="font-mono">UND</span> / <span className="font-mono">ODER</span> (nicht gemischt ohne Klammern)
      </p>
    </div>
  );
}


/* ------------------------------------------------------------------ *
 *  Beispieldaten für die Ergebnistabelle (rein fiktiv)
 * ------------------------------------------------------------------ */
const SAMPLE_ROWS = [
  { auf_id: "A04B260508001", kunde: "Petra Schlicksupp", geburtsdatum: "1958-04-26", kostentraeger: "Postbeamtenkrankenkasse B (PBeaKK)", kostentraegerart: "Privat", filiale: "Filiale 1", erstelldatum: "2026-05-08", liefermethode: "Direktmitnahme", vk_netto: "73.48", vk_brutto: "87.44" },
  { auf_id: "A04B260511002", kunde: "Tobias Mustermann", geburtsdatum: "1949-05-02", kostentraeger: "Privat-KT", kostentraegerart: "Privat", filiale: "CaseFlow", erstelldatum: "2026-05-11" },
  { auf_id: "A04B260512003", kunde: "Annamaria Annika Adelheid", geburtsdatum: "1976-03-11", kostentraeger: "AOK Rheinland-Pfalz / Saarland", kostentraegerart: "GKV", filiale: "Filiale 1", erstelldatum: "2026-05-12", liefermethode: "Abholung", gkv_netto: "171.97" },
  { auf_id: "A04B260513001", kunde: "Klaus Testpatient", geburtsdatum: "2000-01-01", kostentraeger: "hkk", kostentraegerart: "GKV", filiale: "CaseFlow", erstelldatum: "2026-05-13", gkv_netto: "37.60" },
  { auf_id: "A04B260513002", kunde: "Lisa Emilia Frei", geburtsdatum: "1948-11-18", kostentraeger: "actimonda Krankenkasse", kostentraegerart: "GKV", filiale: "CaseFlow", erstelldatum: "2026-05-13" },
  { auf_id: "A04B260515010", kunde: "Testperson Eins", geburtsdatum: "1992-08-18", kostentraeger: "AOK Rheinland/Hamburg", kostentraegerart: "GKV", filiale: "Testfiliale", erstelldatum: "2026-05-15" },
  { auf_id: "A04B260518010", kunde: "Testperson Sieben", geburtsdatum: "1964-06-27", kostentraeger: "(TK) Techniker Krankenkasse", kostentraegerart: "GKV", filiale: "Standort Nord", erstelldatum: "2026-05-18", gkv_netto: "136.71" },
  { auf_id: "A04B260518014", kunde: "Testperson Acht", geburtsdatum: "1999-10-20", kostentraeger: "Barmer GEK", kostentraegerart: "GKV", filiale: "Standort Nord", erstelldatum: "2026-05-18", liefermethode: "Abholung", gkv_netto: "140.20" },
];
const STATUS_STYLES = { "Bestätigt": "bg-emerald-100 text-emerald-700", "Offen": "bg-slate-100 text-slate-600" };
function rowBetrag(row) {
  const val = row.vk_brutto ?? row.gkv_netto ?? row.vk_netto;
  if (val === undefined) return "–";
  return `${parseFloat(val).toFixed(2).replace(".", ",")} €`;
}
function rowStatus(row) {
  return row.vk_brutto || row.vk_netto || row.gkv_netto ? "Bestätigt" : "Offen";
}
function displayDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/* ------------------------------------------------------------------ *
 *  Hauptkomponente
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 *  App-Shell: Sidebar + Header im Stil der echten Anwendung.
 *  Bewusst "pseudo" (keine echte Navigation) – Ziel ist Wiedererkennung
 *  der Struktur (Gruppen, Layout, Farbwelt), nicht eine Kopie des
 *  Original-Markenzeichens/Logos.
 * ------------------------------------------------------------------ */
const NAV_GROUPS = [
  { label: "Portal", items: ["Übersicht", "Digital", "Routing", "BI (lite)", "DATEV"] },
  { label: "Auftragsabwicklung", items: ["Vorgänge", "Controlling", "Abrechnung", "Verschrottung", "Arbeitsaufträge"] },
  { label: "Production", items: ["Insoles"] },
  { label: "Warenverkehr", items: ["Abverkauf/Bedarf", "Bestellung", "Wareneingang extern", "Picklists", "Etiketten"] },
  { label: "Stammdaten", items: ["Kontakte", "BZN", "GKV", "EK/VK Konditionen"] },
  { label: "Einstellungen", items: ["Benutzer", "Gruppen", "Grundeinstellungen"] },
];

function Sidebar({ activeItem }) {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white px-3 py-4 md:block">
      <div className="mb-5 flex items-center gap-2 px-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-orange-500 text-white">
          <Layers className="h-4 w-4" />
        </div>
        <span className="text-sm font-bold tracking-tight text-slate-800">CaseFlow</span>
      </div>
      <nav className="space-y-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-orange-500">{group.label}</div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = item === activeItem;
                return (
                  <div key={item}
                    className={`cursor-default truncate rounded-md px-2 py-1.5 text-sm ${active ? "border-l-2 border-orange-500 bg-orange-50 font-medium text-orange-700" : "text-slate-600 hover:bg-slate-50"}`}>
                    {item}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function Header() {
  return (
    <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-5 py-2.5">
      <div className="flex items-center gap-2 md:hidden">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-orange-500 text-white"><Layers className="h-3.5 w-3.5" /></div>
        <span className="text-sm font-bold text-slate-800">CaseFlow</span>
      </div>
      <div className="flex flex-1 items-center rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-400 max-w-md">
        <Search className="mr-2 h-3.5 w-3.5" /> Suche
      </div>
      <div className="ml-auto flex items-center gap-3 text-slate-400">
        <span className="hidden rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 sm:inline">Keine TSE-Kasse</span>
        <Camera className="h-4 w-4" />
        <Bell className="h-4 w-4" />
        <HelpCircle className="h-4 w-4" />
        <div className="h-7 w-7 rounded-full bg-slate-200" />
      </div>
    </header>
  );
}

export default function QueryConfiguratorPrototype() {
  const [tree, setTree] = useState(() => {
    const g = newGroup();
    g.children[0].field = "erstelldatum";
    g.children[0].operator = "zwischen";
    g.children[0].value = "2026-01-01";
    g.children[0].value2 = "2026-12-31";
    g.children[0].granularity = "tag";
    return g;
  });
  const [viewMode, setViewMode] = useState("builder"); // 'builder' | 'query'
  const [queryText, setQueryText] = useState("");
  const [queryError, setQueryError] = useState(null);

  const [savedFilters, setSavedFilters] = useState([
    { id: "s1", name: "Offene Genehmigungen 2026" },
    { id: "s2", name: "Fällige GKV-Rechnungen" },
  ]);
  const [selectedSaved, setSelectedSaved] = useState("");
  const [lastSearched, setLastSearched] = useState(null);
  const [visibleRows, setVisibleRows] = useState(SAMPLE_ROWS);

  const complete = isComplete(tree);
  const ruleCount = countRules(tree);

  function handleChange(updater) { setTree((prev) => updater(prev)); }
  function handleReset() { setTree(newGroup()); setSelectedSaved(""); setVisibleRows(SAMPLE_ROWS); setLastSearched(null); }

  function goToQueryView() {
    setQueryText(nodeToQueryText(tree));
    setQueryError(null);
    setViewMode("query");
  }
  function tryApplyQuery(switchAfter) {
    if (queryText.includes("⟨")) {
      setQueryError({ message: "Es gibt noch unvollständige Platzhalter (⟨…⟩) – bitte ersetzen, bevor die Abfrage angewendet wird.", index: queryText.indexOf("⟨") });
      return false;
    }
    try {
      const parsed = normalizeTree(parseQuery(queryText));
      setTree(parsed);
      setQueryError(null);
      if (switchAfter) setViewMode("builder");
      return true;
    } catch (e) {
      setQueryError({ message: e.message, index: e.index ?? 0 });
      return false;
    }
  }
  function goToBuilderView() {
    if (viewMode !== "query") { setViewMode("builder"); return; }
    tryApplyQuery(true);
  }


  return (
    <div className="flex min-h-screen bg-slate-100 font-sans">
      <Sidebar activeItem="Controlling" />
      <div className="min-w-0 flex-1">
        <Header />
        <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-6">
          {["Übersicht", "Eskalationsregel", "Konfiguration"].map((tab, idx) => (
            <div key={tab} className={`border-b-2 px-3 py-2.5 text-sm font-medium ${idx === 0 ? "border-orange-500 text-orange-700" : "border-transparent text-slate-400"}`}>
              {tab}
            </div>
          ))}
        </div>

        <main className="mx-auto max-w-5xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-orange-600" />
        <h1 className="text-lg font-semibold text-slate-900">Controlling · Filter</h1>
      </div>
      <div className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">
        Redesign-Konzept · gleiche Felder/Daten, überarbeitete Bedienung – arbeitet mit Beispieldaten
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Tabs Builder / Abfrage */}
        <div className="flex items-center gap-1 border-b border-slate-100 px-4 pt-3">
          <button type="button" onClick={goToBuilderView}
            className={`flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-medium ${viewMode === "builder" ? "border-b-2 border-orange-600 text-orange-700" : "text-slate-400 hover:text-slate-600"}`}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Builder
          </button>
          <button type="button" onClick={goToQueryView}
            className={`flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-medium ${viewMode === "query" ? "border-b-2 border-orange-600 text-orange-700" : "text-slate-400 hover:text-slate-600"}`}>
            <Code2 className="h-3.5 w-3.5" /> Abfrage
          </button>
          {viewMode === "query" && (
            <button type="button" onClick={() => tryApplyQuery(false)}
              className="ml-auto mb-2 flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
              <Check className="h-3.5 w-3.5" /> Anwenden
            </button>
          )}
        </div>

        {viewMode === "builder" ? (
          <div className="px-4 py-3">
            <Group node={tree} depth={0} onChange={handleChange} isRoot />
          </div>
        ) : (
          <QueryView text={queryText} setText={setQueryText} queryError={queryError} />
        )}

        <div className="flex items-start gap-2 border-y border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
          <span className="mt-0.5 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Vorschau</span>
          <span className="text-slate-600">{ruleCount > 0 ? describe(tree) : "Noch keine Bedingung definiert."}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <FolderOpen className="h-4 w-4 text-slate-400" />
            <select value={selectedSaved} onChange={(e) => setSelectedSaved(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 min-w-[200px]">
              <option value="">Gespeicherter Filter…</option>
              {savedFilters.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button type="button" onClick={() => { const name = window.prompt("Name für diesen Filter:"); if (name) setSavedFilters((s) => [...s, { id: uid(), name }]); }}
              className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Save className="h-3.5 w-3.5" /> Als neu speichern
            </button>
            <button type="button" disabled={!selectedSaved}
              className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              <Check className="h-3.5 w-3.5" /> Aktualisieren
            </button>
            <button type="button" disabled={!selectedSaved} onClick={() => { setSavedFilters((s) => s.filter((f) => f.id !== selectedSaved)); setSelectedSaved(""); }}
              className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:text-slate-300">
              <Trash2 className="h-3.5 w-3.5" /> Löschen
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleReset} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100">
              <RotateCcw className="h-3.5 w-3.5" /> Zurücksetzen
            </button>
            <button type="button" disabled={!complete || ruleCount === 0} onClick={() => { setLastSearched(describe(tree)); setVisibleRows(SAMPLE_ROWS.filter((row) => evaluateTree(tree, row))); }}
              className="flex items-center gap-1.5 rounded-md bg-orange-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
              <Search className="h-3.5 w-3.5" /> Suchen
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Ergebnisse</h2>
          {lastSearched && <span className="text-xs text-slate-400">Zuletzt gesucht: {lastSearched} · {visibleRows.length} Treffer</span>}
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Auf.ID</th><th className="px-3 py-2">Kunde</th><th className="px-3 py-2">Kostenträger</th>
                <th className="px-3 py-2">Filiale</th><th className="px-3 py-2">Erstelldatum</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Betrag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400 italic">Keine Treffer für diesen Filter.</td></tr>
              )}
              {visibleRows.map((r) => (
                <tr key={r.auf_id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-orange-600">{r.auf_id}</td>
                  <td className="px-3 py-2 text-slate-700">{r.kunde}</td>
                  <td className="px-3 py-2 text-slate-500">{r.kostentraeger}</td>
                  <td className="px-3 py-2 text-slate-500">{r.filiale}</td>
                  <td className="px-3 py-2 text-slate-500">{displayDate(r.erstelldatum)}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[rowStatus(r)]}`}>{rowStatus(r)}</span></td>
                  <td className="px-3 py-2 text-right text-slate-700">{rowBetrag(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">Beispieldaten aus bereinigtem Test-Export (dumy1.ods) – Namen z. T. bewusste Testeinträge.</p>
      </div>
        </main>
      </div>
    </div>
  );
}
