#!/bin/sh
# Validation + tests for the driver-viz TUI plugin (plugins/driver-viz).
# Kept separate from scripts/validate.sh, which covers the agent/command/skill
# declarations. Used by .github/workflows/release.yml; also runnable locally:
#   ./scripts/validate-driver-viz.sh
# Requires: sh, ruby (with psych/yaml + json stdlib), node >= 22.18 (TS logic tests).
# (shellcheck itself is optional — skipped if absent)
set -eu
cd "$(dirname "$0")/.."

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck scripts/validate-driver-viz.sh
  echo "ok: shellcheck scripts/validate-driver-viz.sh"
else
  echo "skip: shellcheck not installed"
fi

echo "== driver-viz structural checks =="
command -v ruby >/dev/null 2>&1 || { echo "FAIL: ruby is required for validation" >&2; exit 1; }
ruby -ryaml -rjson <<'RUBY'
failures = []
SLUG_RE = '^[A-Z][A-Z0-9]*-[0-9]+$'

pkg_path = "plugins/driver-viz/package.json"
if File.exist?(pkg_path)
  begin
    pkg = JSON.parse(File.read(pkg_path))
    failures << "#{pkg_path}: missing name" if pkg["name"].to_s.empty?
    failures << "#{pkg_path}: exports must map './tui' to the TUI entrypoint" if pkg.dig("exports", "./tui").to_s.empty?
  rescue => e
    failures << "#{pkg_path}: invalid JSON: #{e.message}"
  end
else
  failures << "missing #{pkg_path}"
end

tui = "plugins/driver-viz/tui.tsx"
if File.exist?(tui)
  src = File.read(tui)
  failures << "#{tui}: must register the sidebar.content slot" unless src.include?("sidebar.content")
  failures << "#{tui}: must define plugin id 'driver-viz'" unless src.include?("driver-viz")
else
  failures << "missing #{tui}"
end

# the plugin's phase list must mirror the phase registry table in agents/driver.md section 6
if File.exist?("plugins/driver-viz/lib/phases.ts") && File.exist?("agents/driver.md")
  section6 = File.read("agents/driver.md")[/## 6\..*?(?=## 7\.)/m].to_s
  registry = section6.scan(/^\|\s*\d+\s*\|\s*([a-z-]+)\s*\|/).flatten.uniq.sort
  plugin = File.read("plugins/driver-viz/lib/phases.ts").scan(/id:\s*"([a-z-]+)"/).flatten.uniq.sort
  failures << "plugins/driver-viz/lib/phases.ts phase ids #{plugin.inspect} != agents/driver.md registry #{registry.inspect}" unless plugin == registry
end

# invariant: any plugin lib file that builds .plan/ paths must carry the slug regex
# (tui.tsx and test/ import SLUG_RE from lib/state.ts instead of restating it)
Dir.glob("plugins/driver-viz/lib/*.ts").each do |f|
  src = File.read(f)
  if src.include?(".plan") && !src.include?(SLUG_RE)
    failures << "#{f}: references .plan paths but does not state the slug regex #{SLUG_RE}"
  end
end

# README screenshot: embedded path must exist, and the generator must live in top-level
# scripts/ (NOT under plugins/ — the release payload ships plugins/ and must stay code-only)
shot = "docs/driver-viz-sidebar.png"
gen = "scripts/screenshot-driver-viz.py"
failures << "README.md does not embed #{shot}" unless File.exist?("README.md") && File.read("README.md").include?(shot)
failures << "missing #{shot} (regenerate: python3 #{gen})" unless File.exist?(shot)
failures << "missing #{gen}" unless File.exist?(gen)
failures << "#{gen} must not live under plugins/ (it would ship in the release payload)" if File.exist?("plugins/driver-viz/scripts/screenshot.py")

if failures.empty?
  puts "ok: driver-viz package, entrypoint, phase-registry sync all valid"
else
  failures.each { |f| $stderr.puts "FAIL: #{f}" }
  exit 1
end
RUBY

echo "== driver-viz logic tests =="
# node >= 22.18 strips types by default, so plain `node --test` runs the .ts tests
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const v=process.versions.node.split(".").map(Number); process.exit(v[0]>22||(v[0]===22&&v[1]>=18)?0:1)' 2>/dev/null
}
if node_ok; then
  (cd plugins/driver-viz && node --test test/state.test.ts)
  echo "ok: driver-viz tests (node $(node --version), --test)"
else
  echo "skip: need node >= 22.18 for driver-viz logic tests (found: $(command -v node >/dev/null 2>&1 && node --version || echo none))"
fi

echo "== driver-viz all validations passed =="
