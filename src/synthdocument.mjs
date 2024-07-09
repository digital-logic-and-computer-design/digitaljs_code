//

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import _ from 'lodash';
import { write_txt_file } from './utils.mjs';
import { run_processed_yosys } from './requests.mjs';

let doc_id = 1;

export class SynthDocument {
    #circuit = { devices: {}, connectors: [], subcircuits: {} }
    #last_circuit_changed

    #tick = 0
    #iopanelViews = []
    #iopanelViewIndices = {}
    #runStates = { hascircuit: false, running: false, pendingEvents: false }

    #doc_id

    // Events
    circuitUpdated
    #circuitUpdated // not fired for updates from main circuit views
    #doc_uri 
    #data
    tickUpdated // from circuit view to other view
    #tickUpdated
    showMarker
    #showMarker
    iopanelMessage
    #iopanelMessage
    runStatesUpdated
    #runStatesUpdated
    constructor(doc_uri, data) {
        this.#doc_id = doc_id++;
        this.#doc_uri = doc_uri;
        this.#data = data;
        this.#load(doc_uri, data);
        this.#circuitUpdated = new vscode.EventEmitter();
        this.circuitUpdated = this.#circuitUpdated.event;
        this.#tickUpdated = new vscode.EventEmitter();
        this.tickUpdated = this.#tickUpdated.event;
        this.#showMarker = new vscode.EventEmitter();
        this.showMarker = this.#showMarker.event;
        this.#iopanelMessage = new vscode.EventEmitter();
        this.iopanelMessage = this.#iopanelMessage.event;
        this.#runStatesUpdated = new vscode.EventEmitter();
        this.runStatesUpdated = this.#runStatesUpdated.event;
    }
    dispose() {
    }

    // Properties
    get uri() {
        return this.#doc_uri;
    }
    get doc_id() {
        return this.#doc_id;
    }
    get sources() {
        return {};
    }
    get tick() {
        return this.#tick;
    }
    set tick(tick) {
        if (tick == this.#tick)
            return;
        this.#tick = tick;
        this.#tickUpdated.fire(tick);
    }
    get circuit() {
        return this.#circuit;
    }
    get iopanelViews() {
        return this.#iopanelViews;
    }
    get runStates() {
        return this.#runStates;
    }

    #load(doc_uri, data) {
        this.#circuit = { devices: {}, connectors: [], subcircuits: {} };
        this.#last_circuit_changed = undefined;
    }


    #processMarker(markers) {
        const editor_map = {};
        const getEditorInfo = (name) => {
            let edit_info = editor_map[name];
            if (edit_info)
                return edit_info;
            const src_info = this.sources.findByName(name);
            if (!src_info)
                return;
            const editor = src_info.findEditor();
            if (!editor)
                return;
            edit_info = { editor, markers: [] };
            editor_map[name] = edit_info;
            return edit_info;
        };
        for (const marker of markers) {
            const edit_info = getEditorInfo(marker.name);
            if (!edit_info)
                continue;
            edit_info.markers.push(new vscode.Range(marker.from_line, marker.from_col,
                                                    marker.to_line, marker.to_col));
        }
        this.#showMarker.fire(editor_map);
    }
    #clearMarker() {
        this.#showMarker.fire({});
    }
    #updateCircuit(message) {
        let label;
        let ele_type = message.ele_type || 'Device';
        if (message.type === 'pos') {
            label = `Moving ${ele_type}`;
        }
        else if (message.type === 'vert') {
            label = `Deforming ${ele_type}`;
        }
        else if (message.type === 'src' || message.type === 'tgt') {
            label = `Reconnecting ${ele_type}`;
        }
        else if (message.type === 'add') {
            label = `Adding ${ele_type}`;
        }
        else if (message.type === 'rm') {
            label = `Removing ${ele_type}`;
        }
        else {
            label = `Editing ${ele_type}`;
        }
        this.#circuitEdit(message.circuit, label, false);
    }   
    #circuitEdit(after, label, new_circuit) {
        const before = this.#circuit;
        this.#circuit = after;
        if (!changed) {
            this.#last_circuit_changed = undefined;
            return;
        }
        this.#last_circuit_changed = after;
    }

    #processAutoLayout(message) {
        // If some user action triggers the automatic layout of the circuit,
        // we want to merge the change of the layout to the edit that corresponds
        // to that action, which we'll assume be the previous edit of the ciruit.
        // There are a few cases that we need to be careful though,
        // 1. we don't want to create a new edit just for the auto layout
        //    since it'll make undo basically a no-op (it will trigger another auto layout
        //    and get us back to exactly where we started)
        //    and might confuse the vscode history management.
        //    This means that if we don't have an edit to merge with,
        //    we should not generate a new edit
        // 2. we need to ignore the potential auto layout event after load/undo/redo/revert
        //    since those should set the document to a state that should be clean
        //    unless the user does something explicity.
        // For these reasons, we'll clear the last circuit change if the edit was a no-op
        // and after load/undo/redo/revert.
        if (!this.#last_circuit_changed) {
            this.#circuit = message.circuit;
            return;
        }
        for (const key in this.#last_circuit_changed)
            delete this.#last_circuit_changed[key];
        Object.assign(this.#last_circuit_changed, message.circuit);
        this.#circuit = this.#last_circuit_changed;
    }

    async doSynth() {
        const res = await run_processed_yosys(this.#data);
        this.#circuitEdit(res.output, 'Synthesis', true);
        this.tick = 0;
        this.#circuitUpdated.fire({ run: true, keep: false }); // force a run
        return true;
    }
    // Messages
    #processIOPanelMessage(message) {
        // Cache the state here for the status view at initialization time.
        switch (message.command) {
            case 'iopanel:view': {
                this.#iopanelViewIndices = {};
                for (const idx in message.view)
                    this.#iopanelViewIndices[message.view[idx]] = idx;
                this.#iopanelViews = message.view;
            }
            case 'iopanel:update': {
                const idx = this.#iopanelViewIndices[message.id];
                if (idx !== undefined) {
                    this.#iopanelViews[idx].value = message.value;
                }
            }
        }
        this.#iopanelMessage.fire(message);
    }
    processCommand(message) {
        if (message.command.startsWith('iopanel:')) {
            this.#processIOPanelMessage(message);
            return;
        }
        switch (message.command) {
            case 'updatecircuit':
                this.#updateCircuit(message);
                return;
            case 'autolayout':
                this.#processAutoLayout(message);
                return;
            case 'tick':
                this.tick = message.tick;
                return;
            case 'runstate':
                this.#runStates = { hascircuit: message.hascircuit,
                                    running: message.running,
                                    pendingEvents: message.pendingEvents };
                this.#runStatesUpdated.fire(this.#runStates);
                return;
            case 'luastarted':
//                this.#sources.scriptStarted(message.name);
                return;
            case 'luastop':
//                this.#sources.scriptStopped(message.name);
                return;
            case 'luaerror': {
                if (this.luaTerminal) {
                    this.luaTerminal.creationOptions.pty.print(`ERROR: ${message.message}\n`,
                                                               { start_newline: true });
                    if (this.luaTerminal === vscode.window.activeTerminal) {
                        return;
                    }
                }
                vscode.window.showErrorMessage(message.message);
                return;
            }
            case 'luaprint': {
                const msg = message.messages.join('\t');
                if (this.luaTerminal) {
                    this.luaTerminal.creationOptions.pty.print(msg);
                    if (this.luaTerminal === vscode.window.activeTerminal) {
                        return;
                    }
                }
                vscode.window.showInformationMessage(`${message.label}: ${msg}`);
                return;
            }
            case 'showmarker':
                return this.#processMarker(message.markers);
            case 'clearmarker':
                return this.#clearMarker();
            case 'do-viewsynth':
                return this.doSynth();
        }
    }
}
