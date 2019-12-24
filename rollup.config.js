import babel from 'rollup-plugin-babel';
import builtins from 'rollup-plugin-node-builtins';
import commonjs from '@rollup/plugin-commonjs';
import external from 'rollup-plugin-peer-deps-external';
import resolve from 'rollup-plugin-node-resolve';
import {terser} from "rollup-plugin-terser";

const plugins = [
    external(),
    babel({
        exclude: 'node_modules/**',
    }),
    builtins(),
    resolve(),
    commonjs(),
    terser()
];

export default {
    input: 'index.js',
    output: {
        file: 'dist/index.js',
        format: 'cjs',
    },
    external: [
        "lie",
        "sort-by",
        "cheerio",
        "superagent"
    ],
    plugins,
};
