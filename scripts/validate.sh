#!/bin/sh
# Pre-release validation for opencode-agents.
# Used by .github/workflows/release.yml; also runnable locally: ./scripts/validate.sh
# Requires: sh, ruby (with psych/yaml + json stdlib). shellcheck is optional (skipped if absent).
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

echo "== asset convention files =="
for f in install.sh agents commands skills snippets; do
  [ -e "$f" ] || { echo "FAIL: missing $f" >&2; exit 1; }
done
echo "ok: install.sh + agents/ commands/ skills/ snippets/ present"

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

if failures.empty?
  puts "ok: #{md_files.size} markdown files, schemas, cross-references all valid"
else
  failures.each { |f| $stderr.puts "FAIL: #{f}" }
  exit 1
end
RUBY

echo "== all validations passed =="
