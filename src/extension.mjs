//

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import { yosys2digitaljs } from './requests.mjs';
import { CircuitView } from './circuit_view.mjs';
import { SynthProvider } from './synth_provider.mjs';
import { StatusProvider } from './status_provider.mjs';
import { WebviewMsgQueue } from './webview_msg_queue.mjs';
import { createHash } from 'crypto';

function hash_sha512(data) {
    return createHash('sha512').update(data).digest('hex');
}

async function readTextFile(uri) {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

export function activate(context) {
    new DigitalJS(context);
}

export function deactivate() {
}

class CircuitFile extends vscode.TreeItem {
    constructor(uri) {
        let name = 'Unnamed circuit';
        if (uri)
            name = path.basename(uri.path);
        super(name, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon('circuit-board');
        this.id = 'root-circuit';
        this.contextValue = 'root-circuit';
        this.resourceUri = uri;
    }
}

class SourceFile extends vscode.TreeItem {
    constructor(circuit, uri) {
        let name;
        if (circuit) {
            name = path.relative(path.dirname(circuit.path), uri.path);
        }
        else {
            name = path.basename(uri.path);
        }
        super(name, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('file');
        this.id = uri.toString();
        this.resourceUri = uri;
        this.contextValue = uri.path;
        this.command = { title: 'Open', command: 'vscode.open',
                         arguments: [uri] };
    }
}

class FilesMgr {
    #onDidChangeTreeData
    constructor(djs) {
        this.djs = djs;
        this.circuit = undefined;
        this.sources = new Map();
        this.script_running = {};
        this.script_not_running = {};
        this.#onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.#onDidChangeTreeData.event;
        vscode.commands.executeCommand('setContext', 'digitaljs.script_running', []);
        vscode.commands.executeCommand('setContext', 'digitaljs.script_not_running', []);
    }
    reset(circuit) {
        this.circuit = circuit;
        this.sources.clear();
        this.script_running = {};
        this.script_not_running = {};
        vscode.commands.executeCommand('setContext', 'digitaljs.script_running', []);
        vscode.commands.executeCommand('setContext', 'digitaljs.script_not_running', []);
    }
    refresh() {
        const state = { sources_uri: [] };
        if (this.circuit)
            state.circuit_uri = this.circuit.toString();
        for (let file of this.sources.values())
            state.sources_uri.push(file.toString());
        this.djs.context.workspaceState.update('digitaljs.files', state);
        this.djs.context.workspaceState.update('digitaljs.synth_options',
                                               this.djs.synth_options);
        this.#onDidChangeTreeData.fire();
    }
    addSource(uri) {
        if (this.sources.has(uri.path))
            return;
        this.sources.set(uri.path, uri);
        if (path.extname(uri.path) == '.lua') {
            this.script_not_running[uri.path] = true;
            vscode.commands.executeCommand('setContext', 'digitaljs.script_not_running',
                                           Array.from(Object.keys(this.script_not_running)));
        }
    }
    deleteSource(uri) {
        this.sources.delete(uri.path);
        if (path.extname(uri.path) == '.lua') {
            delete this.script_not_running[uri.path];
            delete this.script_running[uri.path];
            vscode.commands.executeCommand('setContext', 'digitaljs.script_running',
                                           Array.from(Object.keys(this.script_running)));
            vscode.commands.executeCommand('setContext', 'digitaljs.script_not_running',
                                           Array.from(Object.keys(this.script_not_running)));
        }
    }
    scriptStarted(file) {
        delete this.script_not_running[file];
        this.script_running[file] = true;
        vscode.commands.executeCommand('setContext', 'digitaljs.script_running',
                                       Array.from(Object.keys(this.script_running)));
        vscode.commands.executeCommand('setContext', 'digitaljs.script_not_running',
                                       Array.from(Object.keys(this.script_not_running)));
        // The view item doesn't seem to be watching for the context change
        // to redraw the icons so we need to refresh it after updating the running state.
        this.#onDidChangeTreeData.fire();
    }
    scriptStopped(file) {
        delete this.script_running[file];
        this.script_not_running[file] = true;
        vscode.commands.executeCommand('setContext', 'digitaljs.script_running',
                                       Array.from(Object.keys(this.script_running)));
        vscode.commands.executeCommand('setContext', 'digitaljs.script_not_running',
                                       Array.from(Object.keys(this.script_not_running)));
        this.#onDidChangeTreeData.fire();
    }
    toJSON() {
        let res = [];
        const circuit_path = path.dirname(this.circuit.path);
        for (let file of this.sources.values())
            res.push(path.relative(circuit_path, file.path));
        return res;
    }

    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element)
            return [new CircuitFile(this.circuit)];
        console.assert(element instanceof CircuitFile);
        let res = [];
        for (let file of this.sources.values())
            res.push(new SourceFile(this.circuit, file));
        return res;
    }
}

class SourceInfo {
    constructor(uri, sha512) {
        this.uri = uri;
        this.sha512 = sha512;
    }
    findEditor() {
        const uri_str = this.uri.toString();
        const editor = vscode.window.visibleTextEditors.find(
            (e) => e.document.uri.toString() == uri_str);
        if (!editor)
            return;
        const doc = editor.document;
        // Check the content against the hash and cache the result.
        // The `onDidChangeTextDocument` event handler will clear this
        // when the document changes.
        if (this.match === undefined)
            this.match = this.sha512 == hash_sha512(doc.getText());
        return this.match ? editor : undefined;
    }
    toWorkspace() {
        return { uri: this.uri.toString(), sha512: this.sha512 };
    }
    toCircuit(circuit_dir) {
        // Remove time stamps and convert file paths to relative path.
        return { relpath: path.relative(circuit_dir, this.uri.path), sha512: this.sha512 };
    }
    static storeMapWorkspace(source_map) {
        const res = {};
        for (const key in source_map)
            res[key] = source_map[key].toWorkspace();
        return res;
    }
    static storeMapCircuit(circuit, source_map) {
        const circuit_dir = path.dirname(circuit.path);
        const res = {};
        for (const key in source_map)
            res[key] = source_map[key].toCircuit(circuit_dir);
        return res;
    }
    static fromWorkspace(data) {
        if (!data.uri || !data.sha512)
            return;
        return new SourceInfo(vscode.Uri.parse(data.uri), data.sha512);
    }
    static fromCircuit(circuit_uri, json) {
        if (!json.relpath || !json.sha512)
            return;
        return new SourceInfo(vscode.Uri.joinPath(circuit_uri, '..', json.relpath),
                              json.sha512);
    }
    static loadMapWorkspace(storage) {
        if (!storage)
            return {};
        const res = {};
        for (const key in storage) {
            const info = SourceInfo.fromWorkspace(storage[key]);
            if (!info)
                continue;
            res[key] = info;
        }
        return res;
    }
    static loadMapCircuit(circuit, source_map_in) {
        if (!source_map_in)
            return {};
        const source_map_out = {};
        for (const key in source_map_in) {
            const info = SourceInfo.fromCircuit(circuit, source_map_in[key]);
            if (!info)
                continue;
            source_map_out[key] = info;
        }
        return source_map_out;
    }
}

const default_synth_options = {
    opt: false,
    transform: true,
    // lint: true,
    fsm: 'no', // (no)/yes/nomap
    fsmexpand: false
};


class DigitalJS {
    #tickUpdated
    #iopanelMessage
    #circuitChanged
    #circuitView
    constructor(context) {
        this.context = context;

        // Paths
        const ext_uri = context.extensionUri;
        this.iconPath = vscode.Uri.joinPath(ext_uri, 'imgs', 'digitaljs.svg');
        this.mainJSPath = vscode.Uri.joinPath(ext_uri, 'dist', 'view-bundle.js');
        this.synthJSPath = vscode.Uri.joinPath(ext_uri, 'dist', 'synth_view.js');
        this.statusJSPath = vscode.Uri.joinPath(ext_uri, 'dist', 'status_view.js');
        this.uiToolkitPath = vscode.Uri.joinPath(ext_uri, "node_modules", "@vscode",
                                                 "webview-ui-toolkit", "dist",
                                                 "toolkit.min.js");
        this.codIconsPath = vscode.Uri.joinPath(ext_uri, "node_modules", "@vscode",
                                                "codicons", "dist", "codicon.css");
        this.simWorker = readTextFile(vscode.Uri.joinPath(ext_uri, 'dist',
                                                          'digitaljs-sym-worker.js'));

        this.updateCircuitWaits = [];
        this.iopanelViews = [];
        this.iopanelViewIndices = {};

        this.files = new FilesMgr(this);
        this.dirty = false;
        this.circuit = { devices: {}, connectors: [], subcircuits: {} };
        this.source_map = {};
        this.tick = 0;
        this.#tickUpdated = new vscode.EventEmitter();
        this.tickUpdated = this.#tickUpdated.event;
        this.extra_data = {};
        this.synth_options = { ...default_synth_options };

        this.#iopanelMessage = new vscode.EventEmitter();
        this.iopanelMessage = this.#iopanelMessage.event;
        this.#circuitChanged = new vscode.EventEmitter();
        this.circuitChanged = this.#circuitChanged.event;

        this.highlightedEditors = [];
        this.highlightDecoType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('peekViewEditor.matchHighlightBackground'),
            borderColor: new vscode.ThemeColor('peekViewEditor.matchHighlightBorder')
        });
        context.subscriptions.push(this.highlightDecoType);

        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.openView',
                                            () => this.openView()));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.openViewJSON',
                                            (item) => this.openViewJSON(item)));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.openViewSource',
                                            (item) => this.openViewSource(item)));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.pause',
                                            () => this.pauseSim()));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.start',
                                            () => this.startSim()));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.fastForward',
                                            () => this.fastForwardSim()));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.singleStep',
                                            () => this.singleStepSim()));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.nextEvent',
                                            () => this.nextEventSim()));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.newJSON',
                                            () => this.newJSON()));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.openJSON',
                                            () => this.openJSON()));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.addFiles',
                                            () => this.addFiles()));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.saveJSON',
                                            () => this.saveJSON()));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.saveAsJSON',
                                            () => this.saveAsJSON()));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.removeSource',
                                            (item) => this.removeSource(item)));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.startScript',
                                            (item) => this.startScript(item)));
        context.subscriptions.push(
            vscode.commands.registerCommand('digitaljs.stopScript',
                                            (item) => this.stopScript(item)));

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('digitaljs-proj-synth',
                                                      new SynthProvider(this), {}));
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('digitaljs-proj-status',
                                                      new StatusProvider(this),
                                                      { webviewOptions: {
                                                          retainContextWhenHidden: true }}));
        context.subscriptions.push(
            vscode.window.registerTreeDataProvider('digitaljs-proj-files', this.files));

        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                const reverse_source_map = this.getReverseSourceMap();
                const uri_str = e.document.uri.toString();
                const key = reverse_source_map[uri_str];
                if (!key)
                    return;
                // Force a recompute of matching state next time.
                delete this.source_map[key].match;
        }));

        vscode.commands.executeCommand('setContext', 'digitaljs.view_hascircuit', false);
        vscode.commands.executeCommand('setContext', 'digitaljs.view_running', false);
        vscode.commands.executeCommand('setContext', 'digitaljs.view_pendingEvents', false);
        this.restore();
    }
    getReverseSourceMap() {
        // Compute lazily
        if (this.reverse_source_map)
            return this.reverse_source_map;
        const source_map = this.source_map
        const reverse_source_map = {};
        for (const key in source_map)
            reverse_source_map[source_map[key].uri.toString()] = key;
        this.reverse_source_map = reverse_source_map;
        return reverse_source_map;
    }
    async restore() {
        if (!(await this.restoreView()))
            return;
        await this.restoreFiles();
        const circuit_restored = await this.restoreCircuit();
        try {
            await this.restoreMisc(!circuit_restored);
        }
        catch (e) {
            // Ignore
        }
        this.showCircuit(false, true);
    }
    async restoreView() {
        const state = this.context.workspaceState.get('digitaljs.view');
        if (!state || !state.column)
            return false;
        await this.createOrShowView(state.visible, state.column);
        this.dirty = this.context.workspaceState.get('digitaljs.dirty');
        return true;
    }
    async restoreFiles() {
        const state = this.context.workspaceState.get('digitaljs.files');
        if (!state)
            return;
        if (!state.circuit_uri && (!state.sources_uri || !state.sources_uri.length))
            return;
        if (state.circuit_uri)
            this.files.circuit = vscode.Uri.parse(state.circuit_uri);
        if (state.sources_uri) {
            for (const file of state.sources_uri) {
                this.files.addSource(vscode.Uri.parse(file));
            }
        }
        this.files.refresh();
    }
    async restoreCircuit() {
        const circuit = this.context.workspaceState.get('digitaljs.circuit');
        if (circuit) {
            this.circuit = circuit;
            this.source_map = SourceInfo.loadMapWorkspace(
                this.context.workspaceState.get('digitaljs.source_map'));
            this.reverse_source_map = undefined;
            return true;
        }
        return false;
    }
    async restoreMisc(load_circuit) {
        const opt = this.context.workspaceState.get('digitaljs.synth_options');
        if (opt)
            this.synth_options = opt;
        if (this.files.circuit) {
            const json = await this.readJSONFile(this.files.circuit);
            for (const fld of ['devices', 'connectors', 'subcircuits']) {
                if (load_circuit) {
                    const v = json[fld];
                    if (v) {
                        this.circuit[fld] = v;
                    }
                }
                delete json[fld];
            }
            if (json.source_map) {
                if (load_circuit) {
                    this.source_map = SourceInfo.loadMapCircuit(this.files.circuit,
                                                                json.source_map);
                    this.reverse_source_map = undefined;
                    this.context.workspaceState.update(
                        'digitaljs.source_map',
                        SourceInfo.storeMapWorkspace(this.source_map));
                }
                delete json.source_map;
            }
            if (!opt && json.options)
                this.synth_options = json.options;
            delete json.files;
            delete json.options;
            this.extra_data = json;
        }
    }
    setTick(tick) {
        this.tick = tick;
        this.#tickUpdated.fire(tick);
    }
    showCircuit(transform, pause) {
        this.setTick(0);
        this.postPanelMessage({
            command: 'showcircuit',
            circuit: this.circuit,
            opts: { transform, pause }
        });
    }
    createSourceMapForSynth() {
        // Compute a short version of the file name
        const basenames_map = {};
        for (let file of this.files.sources.values()) {
            if (path.extname(file.path) == '.lua')
                continue;
            let key = path.basename(file.path);
            const files = basenames_map[key];
            if (!files) {
                basenames_map[key] = [file];
            }
            else {
                files.push(file);
            }
        }
        if (Object.keys(basenames_map).length == 0) {
            vscode.window.showErrorMessage(`No source file added for synthesis.`);
            return;
        }
        const source_map = {};
        const circuit_file = this.files.circuit;
        for (const basename in basenames_map) {
            const files = basenames_map[basename];
            if (files.length == 1) {
                source_map[basename] = new SourceInfo(files[0]);
                continue;
            }
            for (const file of files) {
                let name;
                if (circuit_file) {
                    name = path.relative(path.dirname(circuit_file.path), file.path);
                }
                else {
                    name = file.path;
                }
                source_map[name] = new SourceInfo(file);
            }
        }
        return source_map;
    }
    async loadSourcesForSynth(source_map) {
        const data = {};
        const docs = {};
        for (const doc of vscode.workspace.textDocuments)
            docs[doc.uri.toString()] = doc;
        for (const key in source_map) {
            const info = source_map[key];
            const uri = info.uri;
            const uri_str = uri.toString();
            const doc = docs[uri_str];
            let content;
            if (doc) {
                content = doc.getText();
            }
            else {
                content = await readTextFile(uri);
            }
            info.sha512 = hash_sha512(content);
            data[key] = content;
        }
        return data;
    }
    async doSynth() {
        this.clearMarker();
        const source_map = this.createSourceMapForSynth();
        if (!source_map)
            return;
        const data = await this.loadSourcesForSynth(source_map);
        const transform = this.synth_options.transform;
        const opts = {
            optimize: this.synth_options.opt,
            fsm: this.synth_options.fsm == "no" ? "" : this.synth_options.fsm,
            fsmexpand: this.synth_options.fsmexpand,
            lint: false
        };
        let res;
        try {
            res = await yosys2digitaljs({ files: data, options: opts });
        }
        catch (e) {
            const error = e.error;
            const yosys_stderr = e.yosys_stderr;
            if (error === undefined && yosys_stderr === undefined) {
                console.log(e);
                return vscode.window.showErrorMessage(`Unknown yosys2digitaljs error.`);
            }
            return vscode.window.showErrorMessage(`Synthesis error: ${error}\n${yosys_stderr}`);
        }
        this.source_map = source_map;
        this.reverse_source_map = undefined;
        this.circuit = res.output;
        this.dirty = true;
        this.context.workspaceState.update('digitaljs.circuit', this.circuit);
        this.context.workspaceState.update('digitaljs.source_map',
                                           SourceInfo.storeMapWorkspace(source_map));
        this.context.workspaceState.update('digitaljs.dirty', true);
        this.showCircuit(transform);
        this.#circuitView.reveal();
    }
    pauseSim() {
        this.postPanelMessage({ command: 'pausesim' });
    }
    startSim() {
        this.postPanelMessage({ command: 'startsim' });
    }
    fastForwardSim() {
        this.postPanelMessage({ command: 'fastforwardsim' });
    }
    singleStepSim() {
        this.postPanelMessage({ command: 'singlestepsim' });
    }
    nextEventSim() {
        this.postPanelMessage({ command: 'nexteventsim' });
    }
    toJSON() {
        return {
            files: this.files.toJSON(),
            options: this.synth_options,
            source_map: SourceInfo.storeMapCircuit(this.files.circuit, this.source_map),
            ...this.circuit,
            ...this.extra_data
        };
    }
    loadJSON(json, uri) {
        this.files.reset(uri);
        this.dirty = false;
        this.context.workspaceState.update('digitaljs.dirty', false);
        if ('files' in json) {
            const files = json.files;
            delete json.files;
            console.assert(uri);
            for (const file of files) {
                this.files.addSource(vscode.Uri.joinPath(uri, '..', file));
            }
        }
        if ('options' in json) {
            this.synth_options = json.options;
            delete json.options;
        }
        else {
            this.synth_options = { ...default_synth_options };
        }
        this.circuit = { devices: {}, connectors: [], subcircuits: {} };
        for (const fld of ['devices', 'connectors', 'subcircuits']) {
            const v = json[fld];
            if (v)
                this.circuit[fld] = v;
            delete json[fld];
        }
        this.context.workspaceState.update('digitaljs.circuit', this.circuit);
        if ('source_map' in json) {
            this.source_map = SourceInfo.loadMapCircuit(uri, json.source_map);
            this.reverse_source_map = undefined;
            delete json.source_map;
        }
        this.context.workspaceState.update('digitaljs.source_map',
                                           SourceInfo.storeMapWorkspace(this.source_map));
        this.extra_data = json;
        this.files.refresh();
        this.#circuitChanged.fire();
        this.showCircuit(false);
    }
    async saveJSONToFile() {
        await new Promise((resolve) => {
            this.updateCircuitWaits.push(resolve);
            this.postPanelMessage({
                command: 'savecircuit',
            });
        });
        console.assert(this.files.circuit);
        const json = this.toJSON();
        const str = JSON.stringify(json);
        await vscode.workspace.fs.writeFile(this.files.circuit, new TextEncoder().encode(str));
        this.dirty = false;
        this.context.workspaceState.update('digitaljs.dirty', false);
    }
    async confirmUnsavedJSON() {
        if (!this.dirty)
            return true;
        const res = await vscode.window.showErrorMessage(`Save current circuit?`,
                                                         'Yes', 'No', 'Cancel');
        if (!res || res == 'Cancel')
            return false;
        if (res == 'Yes')
            await this.saveJSON();
        return true;
    }
    async newJSON() {
        if (!(await this.confirmUnsavedJSON()))
            return;
        this.loadJSON({});
    }
    async readJSONFile(file) {
        let str;
        try {
            str = await readTextFile(file);
        }
        catch (e) {
            await vscode.window.showErrorMessage(`Cannot open ${file}: ${e}`);
            return;
        }
        let json;
        try {
            json = JSON.parse(str);
        }
        catch (e) {
            await vscode.window.showErrorMessage(`${file} is not a valid JSON file: ${e}`);
            return;
        }
        if (typeof json !== "object" || json === null) {
            await vscode.window.showErrorMessage(`${file} is not a valid JSON object.`);
            return;
        }
        return json;
    }
    async loadJSONFile(file) {
        const json = await this.readJSONFile(file);
        if (!json)
            return;
        this.loadJSON(json, file);
    }
    async openJSON() {
        if (!(await this.confirmUnsavedJSON()))
            return;
        const file = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                "Circuit JSON": ['json'],
            }
        });
        if (!file)
            return;
        return this.loadJSONFile(file[0]);
    }
    async addFiles() {
        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            filters: {
                "SystemVerilog": ['sv'],
                "Verilog": ['v'],
                "Verilog HEX file": ['vh'],
                "Lua script": ['lua'],
            }
        });
        if (!files)
            return;
        for (const file of files)
            this.files.addSource(file);
        this.files.refresh();
        this.dirty = true;
        this.context.workspaceState.update('digitaljs.dirty', true);
    }
    async saveJSON() {
        if (!this.files.circuit)
            return this.saveAsJSON();
        try {
            await this.saveJSONToFile();
        }
        catch (e) {
            return vscode.window.showErrorMessage(`Saving to ${this.files.circuit} failed: ${e}`);
        }
        return vscode.window.showInformationMessage(`Circuit saved to ${this.files.circuit}`);
    }
    async saveAsJSON() {
        const files = await vscode.window.showOpenDialog({
            filters: {
                "Circuit JSON": ['json'],
            }
        });
        if (!files)
            return;
        const file = files[0];
        const origin_circuit = this.files.circuit;
        this.files.circuit = file;
        try {
            await this.saveJSONToFile();
        }
        catch (e) {
            this.files.circuit = origin_circuit;
            return vscode.window.showErrorMessage(`Saving as ${file} failed: ${e}`);
        }
        this.files.refresh();
    }
    removeSource(item) {
        this.files.deleteSource(item.resourceUri);
        this.files.refresh();
    }
    async startScript(item) {
        const uri = item.resourceUri;
        const uri_str = uri.toString();
        let script;
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.toString() == uri_str) {
                script = doc.getText();
                continue;
            }
        }
        if (script === undefined)
            script = await readTextFile(uri);
        this.postPanelMessage({
            command: 'runlua',
            name: item.resourceUri.path,
            script
        });
    }
    stopScript(item) {
        this.postPanelMessage({
            command: 'stoplua',
            name: item.resourceUri.path
        });
    }
    showMarker(markers) {
        const editor_map = {};
        const getEditorInfo = (name) => {
            let edit_info = editor_map[name];
            if (edit_info)
                return edit_info;
            const src_info = this.source_map[name];
            if (!src_info)
                return;
            const editor = src_info.findEditor();
            if (!editor)
                return;
            this.highlightedEditors.push(editor);
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
        for (const name in editor_map) {
            const edit_info = editor_map[name];
            edit_info.editor.setDecorations(this.highlightDecoType, edit_info.markers);
        }
    }
    clearMarker() {
        for (const editor of this.highlightedEditors)
            editor.setDecorations(this.highlightDecoType, []);
        this.highlightedEditors.length = 0;
    }
    postPanelMessage(msg) {
        if (!this.#circuitView)
            return;
        this.#circuitView.post(msg);
    }
    processCommand(message) {
        if (message.command.startsWith('iopanel:')) {
            this.processIOPanelMessage(message);
            return;
        }
        switch (message.command) {
            case 'updatecircuit':
                this.circuit = message.circuit;
                this.dirty = true;
                this.context.workspaceState.update('digitaljs.circuit', this.circuit);
                this.context.workspaceState.update('digitaljs.dirty', true);
                let waits = this.updateCircuitWaits;
                this.updateCircuitWaits = [];
                for (const resolve of waits)
                    resolve(null);
                return;
            case 'tick':
                this.setTick(message.tick);
                return;
            case 'runstate':
                vscode.commands.executeCommand('setContext', 'digitaljs.view_hascircuit',
                                               message.hascircuit);
                vscode.commands.executeCommand('setContext', 'digitaljs.view_running',
                                               message.running);
                vscode.commands.executeCommand('setContext', 'digitaljs.view_pendingEvents',
                                               message.hasPendingEvents);
                return;
            case 'luastarted':
                this.files.scriptStarted(message.name);
                return;
            case 'luastop':
                this.files.scriptStopped(message.name);
                return;
            case 'luaerror': {
                let name = message.name;
                if (this.files.circuit)
                    name = path.relative(path.dirname(this.files.circuit.path), name);
                vscode.window.showErrorMessage(`${name}: ${message.message}`);
                return;
            }
            case 'luaprint': {
                let name = message.name;
                if (this.files.circuit)
                    name = path.relative(path.dirname(this.files.circuit.path), name);
                vscode.window.showInformationMessage(`${name}: ${message.messages.join('\t')}`);
                return;
            }
            case 'showmarker':
                return this.showMarker(message.markers);
            case 'clearmarker':
                return this.clearMarker();
        }
    }
    processIOPanelMessage(message) {
        // Cache the state here for the status view at initialization time.
        switch (message.command) {
            case 'iopanel:view': {
                this.iopanelViewIndices = {};
                for (const idx in message.view)
                    this.iopanelViewIndices[message.view[idx]] = idx;
                this.iopanelViews = message.view;
            }
            case 'iopanel:update': {
                const idx = this.iopanelViewIndices[message.id];
                if (idx !== undefined) {
                    this.iopanelViews[idx].value = message.value;
                }
            }
        }
        this.#iopanelMessage.fire(message);
    }
    async openViewJSON(uri) {
        await this.createOrShowView(true);
        if (!(await this.confirmUnsavedJSON()))
            return;
        return this.loadJSONFile(uri);
    }
    async openViewSource(item) {
        await this.createOrShowView(true);
        this.files.addSource(uri);
        this.files.refresh();
        this.dirty = true;
    }
    async openView() {
        const active_editor = vscode.window.activeTextEditor;
        let uri;
        if (active_editor)
            uri = active_editor.document.uri;
        await this.createOrShowView(true);
        if (!uri)
            return;
        const ext = path.extname(uri.path);
        if (ext == '.json') {
            const res = await vscode.window.showInformationMessage(
                `Open ${uri.path} as circuit?`, 'Yes', 'No');
            if (res != 'Yes')
                return;
            if (!(await this.confirmUnsavedJSON()))
                return;
            return this.loadJSONFile(uri);
        }
        if (['.sv', '.v', '.vh', '.lua'].includes(ext)) {
            const res = await vscode.window.showInformationMessage(
                `Add ${uri.path} to current circuit?`, 'Yes', 'No');
            if (res != 'Yes')
                return;
            this.files.addSource(uri);
            this.files.refresh();
            this.dirty = true;
            return;
        }
    }
    async createOrShowView(focus, column) {
        const active = vscode.window.activeTextEditor;
        column = column || (active ? active.viewColumn : undefined);
        if (this.#circuitView) {
            if (focus)
                this.#circuitView.reveal(column);
            return;
        }
        column = column || vscode.ViewColumn.One;
        vscode.commands.executeCommand('setContext', 'digitaljs.view_isactive', true);
        vscode.commands.executeCommand('setContext', 'digitaljs.view_isfocus', true);
        this.#circuitView = new CircuitView(this, focus, column);
        this.context.workspaceState.update('digitaljs.view',
                                           { column: column, visible: true });
        this.#circuitView.onDidDispose(() => {
            // TODO: would be nice if we can try to save here
            // and maybe confirm if the user actually wants to close?
            vscode.commands.executeCommand('setContext', 'digitaljs.view_isactive', false);
            vscode.commands.executeCommand('setContext', 'digitaljs.view_isfocus', false);
            this.#circuitView = undefined;
            this.files.reset();
            this.dirty = false;
            this.circuit = { devices: {}, connectors: [], subcircuits: {} };
            this.source_map = {};
            this.reverse_source_map = undefined;
            this.extra_data = {};
            this.clearMarker();
            this.context.workspaceState.update('digitaljs.view',
                                               { column: undefined, visible: false });
        });
        this.#circuitView.onDidChangeViewState((e) => {
            const panel = e.webviewPanel;
            vscode.commands.executeCommand('setContext', 'digitaljs.view_isfocus',
                                           panel.active);
            if (panel.visible)
                vscode.commands.executeCommand('digitaljs-proj-files.focus');
            this.context.workspaceState.update('digitaljs.view',
                                               { column: panel.viewColumn,
                                                 visible: panel.visible });
        });
        if (focus) {
            vscode.commands.executeCommand('digitaljs-proj-files.focus');
        }
    }
}
