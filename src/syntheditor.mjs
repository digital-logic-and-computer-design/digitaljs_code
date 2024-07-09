//

'use strict';

import * as vscode from 'vscode';
import { SynthCircuitView } from './synthcircuit_view.mjs';
import { SynthDocument } from './synthdocument.mjs';
import { read_txt_file } from './utils.mjs';

export class SynthEditorProvider {
    static viewType = 'digitaljs.circuitView_synthlogic'
    #djs
    onDidChangeCustomDocument
    #onDidChangeCustomDocument
    constructor(djs) {
        this.#djs = djs;
        this.#onDidChangeCustomDocument = new vscode.EventEmitter();
        this.onDidChangeCustomDocument = this.#onDidChangeCustomDocument.event;
    }

    // backupCustomDocument(document, context, _cancel) {
    //     return document.backup(context.destination);
    // }

    async openCustomDocument(uri, context, _cancel) {
        let txt;
        if (context.untitledDocumentData) {
            txt = new TextDecoder().decode(context.untitledDocumentData);
        }
        else {
            const file = context.backupId ? vscode.Uri.parse(context.backupId) : uri;
            txt = (file && file.scheme !== 'untitled') ? await read_txt_file(file) : '{}';
        }
        
        const data = JSON.parse(txt);
        const document = new SynthDocument(uri, data);                          
        return document;
    }

    async resolveCustomEditor(document, panel, _cancel) {
        panel.webview.options = {
            enableScripts: true,
        };
        const circuit_view = new SynthCircuitView(this.#djs, panel, document);
        await circuit_view.init();
        this.#djs.registerSynthDocument(document, circuit_view);
        return;
    }
}
