#!/bin/sh
# Pre-release validation for opencode-agents.
# Used by .github/workflows/release.yml; also runnable locally: ./scripts/validate.sh
# Requires: sh, ruby (with psych/yaml + json stdlib), python3 (agent-scripts are a
# shipped payload — CI on ubuntu-latest has it preinstalled). shellcheck is optional
# (skipped if absent).
set -eu
cd "$(dirname "$0")/.."

echo "== install.sh syntax =="
sh -n install.sh
echo "ok: sh -n install.sh"

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck install.sh
  echo "ok: shellcheck install.sh"
else
  echo "skip: shellcheck not installed"
fi

echo "== install.sh excludes .agent/ and __pycache__ from the payload =="
# regression test: this repo's own driver history (agents/.agent/ etc.) and bytecode
# caches must never be installed — OpenCode discovers agents/**/*.md recursively, so an
# installed .agent/*.md would be registered as an agent (".agent/history" etc.)
install_tmp=$(mktemp -d)
trap 'rm -rf "$install_tmp"' EXIT
./install.sh --source --dest "$install_tmp/cfg" >/dev/null
if find "$install_tmp/cfg" -type d \( -name .agent -o -name __pycache__ \) | grep -q .; then
  echo "FAIL: .agent/ or __pycache__/ installed into $install_tmp/cfg:" >&2
  find "$install_tmp/cfg" -type d \( -name .agent -o -name __pycache__ \) >&2
  exit 1
fi
if grep -Eq '(^|/)(\.agent|__pycache__)/' "$install_tmp/cfg/opencode-agents.manifest"; then
  echo "FAIL: manifest lists .agent/ or __pycache__ entries:" >&2
  grep -E '(^|/)(\.agent|__pycache__)/' "$install_tmp/cfg/opencode-agents.manifest" >&2
  exit 1
fi
echo "ok: no .agent/ or __pycache__/ in installed payload or manifest"

echo "== asset convention files =="
for f in install.sh agents commands skills snippets plugins agent-scripts; do
  [ -e "$f" ] || { echo "FAIL: missing $f" >&2; exit 1; }
done
echo "ok: install.sh + agents/ commands/ skills/ snippets/ plugins/ agent-scripts/ present"

echo "== agent-scripts =="
command -v python3 >/dev/null 2>&1 || { echo "FAIL: python3 is required (agent-scripts/driver-state.py) but not found" >&2; exit 1; }
for s in agent-scripts/*.sh; do
  sh -n "$s"
done
echo "ok: sh -n agent-scripts/*.sh"
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck agent-scripts/*.sh
  echo "ok: shellcheck agent-scripts/*.sh"
else
  echo "skip: shellcheck not installed"
fi
python3 -m py_compile agent-scripts/*.py
echo "ok: py_compile agent-scripts/*.py"
sh agent-scripts/tests/run-tests.sh

command -v ruby >/dev/null 2>&1 || { echo "FAIL: ruby is required for validation" >&2; exit 1; }

echo "== frontmatter / schemas / cross-references =="
ruby -ryaml -rjson <<'RUBY'
failures = []

md_files = Dir.glob("agents/**/*.md") + Dir.glob("commands/**/*.md") + Dir.glob("skills/**/SKILL.md")
md_files.each do |f|
  m = File.read(f).match(/\A---\n(.*?)\n---\n/m)
  if m.nil?
    failures << "#{f}: no frontmatter block"
    next
  end
  begin
    YAML.safe_load(m[1], permitted_classes: [Symbol], aliases: true)
  rescue => e
    failures << "#{f}: invalid YAML frontmatter: #{e.message}"
  end
end

Dir.glob("skills/**/*.json").each do |f|
  begin
    JSON.parse(File.read(f))
  rescue => e
    failures << "#{f}: invalid JSON: #{e.message}"
  end
end

Dir.glob("snippets/*.jsonc").each do |f|
  stripped = File.read(f).gsub(%r{^\s*//.*$}, "").gsub(/,(\s*[}\]])/, '\1')
  begin
    JSON.parse(stripped)
  rescue => e
    failures << "#{f}: invalid JSONC: #{e.message}"
  end
end

# cross-ref: every command's `agent:` must resolve to an agent file agents/<id>.md
Dir.glob("commands/**/*.md").each do |f|
  m = File.read(f).match(/\A---\n(.*?)\n---\n/m)
  next if m.nil?
  data = YAML.safe_load(m[1], permitted_classes: [Symbol], aliases: true) || {}
  agent = data["agent"]
  next if agent.nil? || agent.to_s.empty?
  path = "agents/#{agent}.md"
  failures << "#{f}: agent '#{agent}' has no file #{path}" unless File.exist?(path)
end

# coverage: every real phase agent (non-symlink) in agents/driver/ needs a
# commands/phases/<name>.md wrapper and a row in the driver registry
driver_md = File.read("agents/driver.md")
Dir.glob("agents/driver/*.md").each do |f|
  next if File.symlink?(f) # placeholder variants (e.g. plan-thorough) are exempt
  name = File.basename(f, ".md")
  failures << "no standalone command commands/phases/#{name}.md for agent driver/#{name}" unless File.exist?("commands/phases/#{name}.md")
  failures << "agents/driver.md registry does not mention driver/#{name}" unless driver_md.include?("driver/#{name}")
end

# content invariants across agents/ + the conventions skill
SLUG_RE = '^[A-Z][A-Z0-9]*-[0-9]+$'
content_files = Dir.glob("agents/**/*.md") + Dir.glob("skills/driver-conventions/**/*.md")
content_files.each do |f|
  src = File.read(f)
  # invariant 1: every phase loads the conventions skill
  if f.start_with?("agents/driver") && !src.include?("driver-conventions")
    failures << "#{f}: does not reference the driver-conventions skill"
  end
  # invariant 2: any file that builds .plan/ paths must carry the slug regex
  if src.include?(".plan/<") && !src.include?(SLUG_RE)
    failures << "#{f}: uses .plan/<slug> paths but does not state the slug regex #{SLUG_RE}"
  end
end

# invariant 3: every phase denies `git push *` except pr.md (which must not deny it)
Dir.glob("agents/driver/*.md").each do |f|
  next if File.symlink?(f)
  src = File.read(f)
  push_deny = src.include?('"git push *"') && src.match?(/git push \*.*deny|deny.*git push \*/m)
  if File.basename(f) == "pr.md"
    failures << "#{f}: pr.md must NOT deny 'git push *' (it is the only phase allowed to push)" if push_deny
  else
    failures << "#{f}: missing deny rule for 'git push *'" unless push_deny
  end
end

# invariant 4: the Linear MCP permission block is identical in preplan.md and plan.md
linear_lines = lambda do |f|
  File.readlines(f).select { |l| l =~ /linear[-_]project/ && l.strip.start_with?("- {") }
end
preplan_lin = linear_lines.call("agents/driver/preplan.md")
plan_lin = linear_lines.call("agents/driver/plan.md")
if preplan_lin.empty? || plan_lin.empty? || preplan_lin != plan_lin
  failures << "agents/driver/preplan.md and agents/driver/plan.md: linear-project permission blocks differ (or missing) — keep them byte-identical"
end

# invariant 5: the shipped driver-state.py carries the slug regex (its .plan/<slug>
# path guard validates slugs against it)
unless File.read("agent-scripts/driver-state.py").include?(SLUG_RE)
  failures << "agent-scripts/driver-state.py: missing slug regex #{SLUG_RE}"
end

if failures.empty?
  puts "ok: #{md_files.size} markdown files, schemas, cross-references all valid"
else
  failures.each { |f| $stderr.puts "FAIL: #{f}" }
  exit 1
end
RUBY

echo "== all validations passed =="
