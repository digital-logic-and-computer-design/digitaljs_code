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
        console.log("Creating Synth Editor!")
        this.#djs = djs;
        this.#onDidChangeCustomDocument = new vscode.EventEmitter();
        this.onDidChangeCustomDocument = this.#onDidChangeCustomDocument.event;
    }

    // backupCustomDocument(document, context, _cancel) {
    //     return document.backup(context.destination);
    // }

    async openCustomDocument(uri, context, _cancel) {
        console.log("Opening Custom Document!")
        let txt;
        if (context.untitledDocumentData) {
            txt = new TextDecoder().decode(context.untitledDocumentData);
        }
        else {
            const file = context.backupId ? vscode.Uri.parse(context.backupId) : uri;
            txt = (file && file.scheme !== 'untitled') ? await read_txt_file(file) : '{}';
        }
        
        const data = JSON.parse(txt);
        console.log("Data:")
        console.dir(data)
        const document = new SynthDocument(uri, data);                          
        console.dir(document)
        document.documentEdited(e => {
            this.#onDidChangeCustomDocument.fire(e);
        });
        return document;
    }

    async resolveCustomEditor(document, panel, _cancel) {
        console.log("Resolving Custom Editor!")
        panel.webview.options = {
            enableScripts: true,
        };
        console.log("Creating view!")
        const circuit_view = new SynthCircuitView(this.#djs, panel, document);
        console.log("Initializing view!")
        await circuit_view.init();
//        this.#djs.registerDocument(document, circuit_view);
        return;
    }

    async revertCustomDocument(document, _cancel) {
        // Read only view / document
    }

    saveCustomDocument(document, _cancel) {
        // Read only view / document
        return false;
    }

    saveCustomDocumentAs(document, uri, _cancel) {
        // Read only view / document
        return false;
    }
}
