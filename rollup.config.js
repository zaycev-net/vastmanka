import babel from 'rollup-plugin-babel';
import json from 'rollup-plugin-json';
import nodeResolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import rollupReplace from 'rollup-plugin-replace';
import { uglify } from "rollup-plugin-uglify";

const plugins = [
    babel({
        exclude: 'node_modules/**',
    }),
    json(),
    nodeResolve(),
    rollupReplace({
        'global.GENTLY': false,
    }),
    commonjs(),
    uglify()
];

export default {
    input: 'index.js',
    external: [
        "browserify-versionify",
        "lie",
        "sort-by",
        "vastacular"
    ],
    plugins,
    output: {
        file: 'dist/index.js',
        format: 'cjs',
    },
};
