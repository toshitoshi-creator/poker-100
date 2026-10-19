// Inline the Vite build (JS + CSS) into one HTML file that can be hosted anywhere,
// e.g. as a claude.ai Artifact, and opened on a phone.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const js = html.match(/<script type="module" crossorigin src="\/(.+?)"><\/script>/)[1];
const css = html.match(/<link rel="stylesheet" crossorigin href="\/(.+?)">/)[1];
const jsSrc = readFileSync(`dist/${js}`, 'utf8').replace(/<\/script/gi, '<\\/script');
const cssSrc = readFileSync(`dist/${css}`, 'utf8');

const out = `<title>Poker 100 Survival</title>
<meta name="theme-color" content="#0b1a14">
<style>${cssSrc}
/* Hosted page: the host pads :root by the safe-area insets already. */
html,body,#root{height:100%}
.app{height:100%;padding-top:0;padding-bottom:0}
</style>
<div id="root"></div>
<script type="module">${jsSrc}</script>
`;
mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/poker-100.html', out);
console.log(`dist-single/poker-100.html ${(out.length / 1024).toFixed(1)} KB`);
