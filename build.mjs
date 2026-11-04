// Builds the static site into dist/ (used by Vercel and for local testing).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const out = 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const v = Date.now().toString(36);
await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  outfile: `${out}/app.js`,
  define: {
    'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL || ''),
    'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY || ''),
  },
  legalComments: 'none',
});
cpSync('src/style.css', `${out}/style.css`);
cpSync('public', out, { recursive: true });
writeFileSync(`${out}/index.html`, readFileSync('index.html', 'utf8').replaceAll('__V__', v));
console.log('built dist/ version', v);
