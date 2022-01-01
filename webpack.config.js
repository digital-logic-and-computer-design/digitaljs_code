const path = require("path");
const webpack = require('webpack');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const outputDirectory = "dist";

function main_view_config(env, argv) {
    const devMode = argv.mode !== "production";
    return {
        name: 'main-view',
        entry: "./view/main.js",
        output: {
            path: path.join(__dirname, outputDirectory),
            filename: "view-bundle.js"
        },
        module: {
            rules: [
                {
                    test: /\.css$/,
                    use: [devMode ? "style-loader" : MiniCssExtractPlugin.loader, "css-loader"]
                },
                {
                    test: /\.scss$/,
                    use: [devMode ? "style-loader" : MiniCssExtractPlugin.loader, "css-loader",
                          "sass-loader"]
                },
                {
                    test: /\.(png|woff|woff2|eot|ttf|svg)$/,
                    type: 'asset/inline'
                },
                {
                    test: require.resolve('jquery'),
                    loader: 'expose-loader',
                    options: {
                        exposes: ['$']
                    }
                },
            ]
        },
        plugins: [
        ].concat(devMode ? [] : [new MiniCssExtractPlugin()]),
    };
}

function digitaljs_worker_config(env, argv) {
    const devMode = argv.mode !== "production";
    return {
        name: 'web_worker',
        target: 'webworker',
        entry: "./node_modules/digitaljs/src/engines/worker-worker.mjs",
        output: {
            path: path.join(__dirname, outputDirectory),
            filename: "digitaljs-sym-worker.js"
        },
        plugins: [
            new webpack.optimize.LimitChunkCountPlugin({
                maxChunks: 1
            })
        ]
    };
}

module.exports = [main_view_config, digitaljs_worker_config];
