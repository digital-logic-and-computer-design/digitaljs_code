
# Script
        "open-in-browser": "vscode-test-web --extensionDevelopmentPath=. ."

# Dependencies

        "digitaljs": "github:yuyichao/digitaljs#dev",  +7 / -12
        "digitaljs_lua": "github:yuyichao/digitaljs_lua#dev", +5 / -2
        "yosysjs": "github:yuyichao/yosysjs"  // Owner; 2 months old
        "yosys2digitaljs": "^0.6.0",

# Flow

requests.js:
        process_files() runs yosys commands and makes output.json
        run_yosys
                does process_files()
                then does yosys2digitaljs 
        ```
                const yosys = new Yosys();
                await yosys.init();
                const obj = yosys.process_files(files, options);
                let output = yosys2digitaljs.yosys2digitaljs(obj, options);
                yosys2digitaljs.io_ui(output);
                if (options.transform)
                        output = digitaljs_transform.transformCircuit(output);
                return { output };
        ```

        Added run_process_yosys(obj, options) 
                obj obj is parsed JSON object from Yosys options can be omitted (ConvertOptions = {   propagation?: number,};)

        Can head that off...

sources.mjs does the call to run_yosys() from doSynth().

Need to find file-opening chain stuff....

extension.mjs registers the viewer.

EditorProvider is the viewer.  (editor.mjs)
        Opens a CircuitView (circuit_view.mjs) with the JSON-ed document.
                Calls init() which calls getViewContent()



requests.mjs has commented out parts of yosys include / calls. 


document.mjs
        added load_synth and it's called when extension is synthlogic.
        








        "node_modules/acorn": {
            "version": "8.7.0",
            "resolved": "https://registry.npmjs.org/acorn/-/acorn-8.7.0.tgz",
            "integrity": "sha512-V/LGr1APy+PXIwKebEWrkZPwoeoF+w1jiOBUmuxuiUIaOHtob8Qc9BTrYo7VuI5fR8tqsy+buA2WFooR5olqvQ==",
            "dev": true,
            "bin": {
                "acorn": "bin/acorn"
            },
            "engines": {
                "node": ">=0.4.0"
            }
        },
        "node_modules/acorn-import-assertions": {
            "version": "1.8.0",
            "resolved": "https://registry.npmjs.org/acorn-import-assertions/-/acorn-import-assertions-1.8.0.tgz",
            "integrity": "sha512-m7VZ3jwz4eK6A4Vtt8Ew1/mNbP24u0FhdyfA7fSvnJR6LMdfOYnmuIrrJAgrYfYJ10F/otaHTtrtrtmHdMNzEw==",
            "dev": true,
            "peerDependencies": {
                "acorn": "^8"
            }
        },
        "node_modules/acorn-jsx": {
            "version": "5.3.2",
            "resolved": "https://registry.npmjs.org/acorn-jsx/-/acorn-jsx-5.3.2.tgz",
            "integrity": "sha512-rq9s+JNhf0IChjtDXxllJ7g41oZk5SlXtp0LHwyA5cejwn7vKmKp4pPri6YEePv2PU65sAsegbXtIinmDFDXgQ==",
            "dev": true,
            "peerDependencies": {
                "acorn": "^6.0.0 || ^7.0.0 || ^8.0.0"
            }
        },


                "digitaljs": "github:yuyichao/digitaljs#dev",
        "digitaljs_lua": "github:yuyichao/digitaljs_lua#dev",



sources doSynth()
        run_yosys()

# Building Package

May need to test/revise this. Didn't work, but prob. because publisher in package.json contained invalid characters. 