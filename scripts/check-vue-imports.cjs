#!/usr/bin/env node
/*
 * Vue composition-API helpers used without being imported.
 *
 * WHY THIS EXISTS. `npm run lint` is `eslint . --ext .ts,.tsx` — it does not
 * look at a .vue file at all — and `vite build` compiles an SFC without
 * resolving the identifiers in it. So a `<script setup>` that calls
 * `computed()` without importing it builds clean and fails at runtime with
 * "computed is not defined", which is what happened to the admin portal's
 * System Settings page: the build passed and the page was dead on arrival.
 *
 * eslint-plugin-vue with no-undef is the proper fix and is not installed. This
 * is the narrow version: it knows the names that come from 'vue' and checks
 * that a file calling one of them imports it. That is the whole of the bug it
 * is replacing, and it needs no dependency.
 *
 * Deliberately NOT a general undefined-variable check. It would need real
 * scope analysis to avoid false positives on locals, props and template refs,
 * and a check that cries wolf is a check that gets switched off.
 *
 * Run: node scripts/check-vue-imports.cjs
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) {
    if (detail) console.log('         ' + detail);
    failures++;
  }
};

const ROOT = path.join(__dirname, '..');

// Everything a `<script setup>` in this repo plausibly calls from 'vue'.
// Reactivity, lifecycle and the few utilities. Not components or types.
const VUE_NAMES = [
  'ref', 'shallowRef', 'computed', 'reactive', 'readonly', 'toRef', 'toRefs',
  'toRaw', 'markRaw', 'unref', 'isRef',
  'watch', 'watchEffect', 'watchPostEffect', 'nextTick',
  'onMounted', 'onUnmounted', 'onBeforeMount', 'onBeforeUnmount',
  'onUpdated', 'onBeforeUpdate', 'onActivated', 'onDeactivated',
  'onErrorCaptured', 'onRenderTracked',
  'provide', 'inject', 'useSlots', 'useAttrs', 'defineAsyncComponent',
  'getCurrentInstance', 'customRef', 'effectScope',
];

function vueFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...vueFiles(full));
    else if (entry.name.endsWith('.vue')) out.push(full);
  }
  return out;
}

/** The <script> blocks, with comments and strings blanked so a name mentioned
 *  in prose or inside a template literal is not read as a call. */
function scriptSource(src) {
  const blocks = [...src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .join('\n');
  return blocks
    .replace(/\/\*[\s\S]*?\*\//g, ' ')       // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')   // line comments, sparing https://
    .replace(/`(?:\\.|[^`\\])*`/g, '``')     // template literals
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

const files = vueFiles(path.join(ROOT, 'src'));

console.log(`checking ${files.length} .vue files`);
{
  ok('there are .vue files to check', files.length > 5, `${files.length}`);

  const offenders = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const script = scriptSource(raw);

    // Imports are read from the RAW source, because scriptSource blanks the
    // module string they are identified by.
    const imported = new Set();
    for (const m of raw.matchAll(
      /import\s*\{([^}]*)\}\s*from\s*['"]vue['"]/g,
    )) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) imported.add(name);
      }
    }
    // `import * as Vue from 'vue'` or a default import means anything goes.
    const wildcard = /import\s+(?:\*\s+as\s+\w+|\w+)\s*from\s*['"]vue['"]/.test(raw);

    for (const name of VUE_NAMES) {
      // Called, not merely mentioned: `computed(` or `computed (`.
      const used = new RegExp(`(?<![\\w.$])${name}\\s*\\(`).test(script);
      if (!used || imported.has(name) || wildcard) continue;
      // Could be a local of the same name — a function or a const.
      const localised = new RegExp(
        `(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b)`,
      ).test(script);
      if (localised) continue;
      offenders.push(`${path.relative(ROOT, file)}: ${name}() is not imported`);
    }
  }

  ok('every Vue helper a .vue file calls is imported', offenders.length === 0,
    offenders.join('\n         '));
}

console.log('\nthe check would have caught the one that shipped');
{
  // A file that calls computed() with only ref imported — the admin portal's
  // System Settings page, exactly as it was.
  const probe = `<script setup>
import { ref, onMounted } from 'vue'
const config = ref({})
const feePctInput = computed({ get: () => 0, set: () => {} })
onMounted(() => {})
</script>`;
  const script = scriptSource(probe);
  const imported = new Set(
    [...probe.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]vue['"]/g)]
      .flatMap((m) => m[1].split(',').map((p) => p.trim())),
  );
  const missing = VUE_NAMES.filter(
    (n) => new RegExp(`(?<![\\w.$])${n}\\s*\\(`).test(script) && !imported.has(n),
  );
  ok('it flags the real case', missing.includes('computed'), missing.join(', '));
  ok('and nothing else in it', missing.length === 1, missing.join(', '));
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed — no .vue file calls a Vue helper it did not import');
