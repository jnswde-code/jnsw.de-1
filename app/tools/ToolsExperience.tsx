"use client";

import { useRef } from "react";
import { PdfWorkbench } from "./pdf-zusammenfuegen/PdfWorkbench";
import { WohnungssucheWorkbench } from "./wohnungssuche/WohnungssucheWorkbench";
import QueryConfiguratorPrototype from "./query-konfigurator/QueryConfiguratorPrototype";
import { SupportKiWorkbench } from "./support-ki/SupportKiWorkbench";

export function ToolsExperience() {
  const pdfDialogRef = useRef<HTMLDialogElement>(null);
  const pdfTriggerRef = useRef<HTMLButtonElement>(null);
  const closePdfTool = () => pdfDialogRef.current?.close();

  const wohnungDialogRef = useRef<HTMLDialogElement>(null);
  const wohnungTriggerRef = useRef<HTMLButtonElement>(null);
  const closeWohnungTool = () => wohnungDialogRef.current?.close();

  const queryDialogRef = useRef<HTMLDialogElement>(null);
  const queryTriggerRef = useRef<HTMLButtonElement>(null);
  const closeQueryTool = () => queryDialogRef.current?.close();

  const supportKiDialogRef = useRef<HTMLDialogElement>(null);
  const supportKiTriggerRef = useRef<HTMLButtonElement>(null);
  const closeSupportKiTool = () => supportKiDialogRef.current?.close();

  return (
    <>
      <section className="tools-directory" aria-labelledby="tools-directory-title">
        <div className="tools-directory-heading">
          <p className="eyebrow">01–04 / Verfügbar</p>
          <p id="tools-directory-title">Werkzeuge, die eine konkrete Aufgabe lösen.</p>
        </div>
        <button
          ref={pdfTriggerRef}
          type="button"
          className="tool-row"
          onClick={() => pdfDialogRef.current?.showModal()}
        >
          <span className="tool-index">01</span>
          <span className="tool-title">PDF-Werkbank</span>
          <span className="tool-meta">Verbinden · umbenennen · ZIP · lokal</span>
          <span className="tool-arrow" aria-hidden="true">
            ↗
          </span>
        </button>
        <button
          ref={wohnungTriggerRef}
          type="button"
          className="tool-row"
          onClick={() => wohnungDialogRef.current?.showModal()}
        >
          <span className="tool-index">02</span>
          <span className="tool-title">Wohnungssuche-Assistent</span>
          <span className="tool-meta">Prototyp · Mock-Daten · Freigabe-Queue</span>
          <span className="tool-arrow" aria-hidden="true">
            ↗
          </span>
        </button>
        <button
          ref={queryTriggerRef}
          type="button"
          className="tool-row"
          onClick={() => queryDialogRef.current?.showModal()}
        >
          <span className="tool-index">03</span>
          <span className="tool-title">Abfrage-Konfigurator</span>
          <span className="tool-meta">Prototyp · Regelbaum · Text-Abfrage</span>
          <span className="tool-arrow" aria-hidden="true">
            ↗
          </span>
        </button>
        <button
          ref={supportKiTriggerRef}
          type="button"
          className="tool-row"
          onClick={() => supportKiDialogRef.current?.showModal()}
        >
          <span className="tool-index">04</span>
          <span className="tool-title">Support-KI</span>
          <span className="tool-meta">Chat & Sprachdialog · SimpliSan Support</span>
          <span className="tool-arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      </section>
      <dialog
        ref={pdfDialogRef}
        className="tool-dialog"
        aria-labelledby="pdf-workspace-title"
        onCancel={closePdfTool}
        onClose={() => pdfTriggerRef.current?.focus()}
        onClick={(event) => {
          if (event.target === pdfDialogRef.current) closePdfTool();
        }}
      >
        <div className="tool-workspace">
          <header className="tool-workspace-header">
            <div>
              <p className="eyebrow">JNSW.DE / Tools / PDF</p>
              <h2 id="pdf-workspace-title">PDF-Werkbank</h2>
            </div>
            <p className="workspace-privacy">
              <span aria-hidden="true">●</span> Verarbeitung lokal im Browser
            </p>
            <button
              type="button"
              className="workspace-close"
              onClick={closePdfTool}
              aria-label="PDF-Werkzeug schließen"
            >
              <span>Schließen</span>
              <b aria-hidden="true">×</b>
            </button>
          </header>
          <div className="tool-workspace-body">
            <PdfWorkbench />
          </div>
        </div>
      </dialog>
      <dialog
        ref={wohnungDialogRef}
        className="tool-dialog"
        aria-labelledby="wohnung-workspace-title"
        onCancel={closeWohnungTool}
        onClose={() => wohnungTriggerRef.current?.focus()}
        onClick={(event) => {
          if (event.target === wohnungDialogRef.current) closeWohnungTool();
        }}
      >
        <div className="tool-workspace">
          <header className="tool-workspace-header">
            <div>
              <p className="eyebrow">JNSW.DE / Tools / Prototyp</p>
              <h2 id="wohnung-workspace-title">Wohnungssuche-Assistent</h2>
            </div>
            <p className="workspace-privacy">
              <span aria-hidden="true">●</span> Prototyp · Mock-Daten, kein Backend
            </p>
            <button
              type="button"
              className="workspace-close"
              onClick={closeWohnungTool}
              aria-label="Wohnungssuche-Prototyp schließen"
            >
              <span>Schließen</span>
              <b aria-hidden="true">×</b>
            </button>
          </header>
          <div className="tool-workspace-body">
            <WohnungssucheWorkbench />
          </div>
        </div>
      </dialog>
      <dialog
        ref={queryDialogRef}
        className="tool-dialog"
        aria-labelledby="query-workspace-title"
        onCancel={closeQueryTool}
        onClose={() => queryTriggerRef.current?.focus()}
        onClick={(event) => {
          if (event.target === queryDialogRef.current) closeQueryTool();
        }}
      >
        <div className="tool-workspace">
          <header className="tool-workspace-header">
            <div>
              <p className="eyebrow">JNSW.DE / Tools / Prototyp</p>
              <h2 id="query-workspace-title">Abfrage-Konfigurator</h2>
            </div>
            <p className="workspace-privacy">
              <span aria-hidden="true">●</span> Prototyp · Beispieldaten, kein Backend
            </p>
            <button
              type="button"
              className="workspace-close"
              onClick={closeQueryTool}
              aria-label="Abfrage-Konfigurator schließen"
            >
              <span>Schließen</span>
              <b aria-hidden="true">×</b>
            </button>
          </header>
          <div className="tool-workspace-body">
            <QueryConfiguratorPrototype />
          </div>
        </div>
      </dialog>
      <dialog
        ref={supportKiDialogRef}
        className="tool-dialog"
        aria-labelledby="support-ki-workspace-title"
        onCancel={closeSupportKiTool}
        onClose={() => supportKiTriggerRef.current?.focus()}
        onClick={(event) => {
          if (event.target === supportKiDialogRef.current) closeSupportKiTool();
        }}
      >
        <div className="tool-workspace">
          <header className="tool-workspace-header">
            <div>
              <p className="eyebrow">JNSW.DE / Tools / Support-KI</p>
              <h2 id="support-ki-workspace-title">Support-KI</h2>
            </div>
            <p className="workspace-privacy">
              <span aria-hidden="true">●</span> Live-Verbindung via LiveKit
            </p>
            <button
              type="button"
              className="workspace-close"
              onClick={closeSupportKiTool}
              aria-label="Support-KI schließen"
            >
              <span>Schließen</span>
              <b aria-hidden="true">×</b>
            </button>
          </header>
          <div className="tool-workspace-body">
            <SupportKiWorkbench />
          </div>
        </div>
      </dialog>
    </>
  );
}
