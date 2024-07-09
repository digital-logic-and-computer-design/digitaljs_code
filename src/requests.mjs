//

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
//import yosys from 'yosysjs';
import yosys2digitaljs from 'yosys2digitaljs';
import * as digitaljs_transform from '../node_modules/digitaljs/src/transform.mjs';

const rand_prefix = 'djs-IxU5De4QZDxUgn43Zwj1-_';
const rand_suffix = '_-hbtdHFLoSvFPbPLnGSp8';
const match_regex = new RegExp(`${rand_prefix}(\\d+)${rand_suffix}`, 'g');

class FileMap {
    #names = []
    map_name(name) {
        const idx = this.#names.length;
        this.#names.push(name);
        return `${rand_prefix}${idx}${rand_suffix}`;
    }
    unmap_string(str) {
        return str.replaceAll(match_regex, (match, p1) => this.#names[parseInt(p1)]);
    }
}


export async function run_yosys(files, options) {
    // const yosys = new Yosys();
    // await yosys.init();
    // const obj = yosys.process_files(files, options);
    // return run_processed_yosys(obj, options);
}

export async function run_processed_yosys(obj, options) {
    if(options === undefined) {
        // TODO / Check
        options = {};
    }
    let output = yosys2digitaljs.yosys2digitaljs(obj, options);
    yosys2digitaljs.io_ui(output);
    if (options.transform)
        output = digitaljs_transform.transformCircuit(output);
    return { output };
}
