#!/usr/bin/env bash
# Survey a C# / .NET solution for the facts a code-style, error-handling and review-checklist
# node needs. Run from the solution root. Output is meant to be read, not parsed.
set -u
CS='--include=*.cs'
X='--exclude-dir=obj --exclude-dir=bin --exclude-dir=node_modules --exclude-dir=Migrations'
g() { grep -rE "$@" $CS $X . 2>/dev/null; }
count() { g "$@" | wc -l; }

echo "### projects"
find . -name '*.csproj' -not -path '*/node_modules/*' | while read -r f; do
  echo "== $f"; grep -E 'TargetFramework|Nullable|ImplicitUsings|LangVersion|TreatWarningsAsErrors|PackageReference' "$f"
done
echo "editorconfig: $(find . -maxdepth 2 -name .editorconfig | wc -l)"
echo "cs files: $(find . -name '*.cs' -not -path '*/obj/*' -not -path '*/bin/*' | wc -l)  razor: $(find . -name '*.razor' -not -path '*/obj/*' | wc -l)  razor.cs: $(find . -name '*.razor.cs' -not -path '*/obj/*' | wc -l)  razor.css: $(find . -name '*.razor.css' -not -path '*/obj/*' | wc -l)"

echo "### namespaces  file-scoped=$(g -l '^namespace [A-Za-z.]+;' | wc -l)  block=$(g -l '^namespace [A-Za-z.]+\s*$' | wc -l)"
echo "### null checks  '== null'=$(count '[!=]= null\b')  outside-lambda=$(g '[!=]= null\b' | grep -vc '=>')  'is null'=$(count '\bis (not )?null\b')"
echo "### constants"; g '\bconst\b' | grep -E '[A-Z_]{6,} =' | head -5; echo "SCREAMING consts: $(g '\bconst\b' | grep -cE ' [A-Z][A-Z_]{4,} =')"
echo "### private fields  _prefixed=$(count 'private (readonly |static )*[A-Za-z<>?,\[\] ]+ _[a-z]')  unprefixed=$(g 'private (readonly |static )*[A-Za-z<>?,\[\] ]+ [a-z][A-Za-z]* *(=|;)' | grep -vc ' const ')"
echo "### primary ctors=$(count '^(public |internal )?(sealed )?(partial )?class [A-Za-z]+\(')  field-assign-in-ctor=$(count '^\s+_[a-z][A-Za-z]* = [a-z]')"
echo "### Task methods  with Async suffix=$(count '(public|private|internal|protected)( static)?( async)? (Task|ValueTask)(<[^>]+>)? [A-Z][A-Za-z]*Async\(')  without=$(g '(public|private|internal|protected)( static)?( async)? (Task|ValueTask)(<[^>]+>)? [A-Z][A-Za-z]*\(' | grep -vc 'Async\(')"
g '(public|private|internal|protected)( static)?( async)? (Task|ValueTask)(<[^>]+>)? [A-Z][A-Za-z]*\(' | grep -v 'Async\(' | sed -E 's/.* (Task|ValueTask)(<[^>]+>)? ([A-Za-z]+)\(.*/\3/' | sort | uniq -c | sort -rn | head -8
echo "### records=$(count '\brecord\b')  classes=$(count '\bclass\b')  sealed=$(count 'sealed (class|record)')  required=$(count '\brequired\b')  null!=$(count 'null!')"
echo "### collections  '= [];'=$(count '= \[\];')  'new List<'=$(count 'new List<')  '= new();'=$(count '= new\(\);')"
echo "### braces  K&R decl=$(count '^\s*(public|private|internal|protected).*\)\s*\{\s*$')  'if (...) {' same line=$(count '^\s*if \(.*\)\s*\{\s*$')  braceless same-line if=$(count '^\s*if \(.*\) (return|continue|break|throw|[a-z_A-Z]+ ?=)')  braceless next-line if=$(g -A1 '^\s*if \(.*\)\s*$' | grep -cE '^\S+-\s+(return|continue|throw|[a-zA-Z_]+ ?=|[a-zA-Z_.]+\()')"
echo "### trailing comma in initialisers  yes=$(g -B1 '^\s*\};?\s*$' | grep -cE '^\S+-.*,\s*$')  no=$(g -B1 '^\s*\};?\s*$' | grep -cE '^\S+-\s+[A-Za-z]+ = .*[^,{;]\s*$')"
echo "### expression-bodied=$(g '\)\s*=>\s*$|\) =>\s*\S' | grep -cE '(public|private|internal|protected|static)')  switch-expr=$(count '\bswitch\s*$')  'switch ('=$(count '\bswitch \(')"
n=0; t=0; for f in $(g -l '^using '); do t=$((t+1)); awk '/^using /{u=1} u && /^$/{b=1} u && b && /^using /{found=1} END{exit !found}' "$f" && n=$((n+1)); done; echo "### using groups separated by blank line: $n of $t files"
echo "### logging  Console.WriteLine=$(count 'Console\.WriteLine')  ILogger<=$(count 'ILogger<')"; g -l 'Console\.WriteLine' | cut -d/ -f2-3 | sort | uniq -c
echo "### time  DateTime.Now=$(count 'DateTime\.Now\b')  UtcNow=$(count 'DateTime\.UtcNow')  TimeProvider=$(count 'TimeProvider')  DateTimeOffset=$(count 'DateTimeOffset')"
echo "### async  ConfigureAwait=$(count 'ConfigureAwait')  .Result=$(count '\.Result\b')  .Wait()=$(count '\.Wait\(\)')  'async void'=$(count 'async void')"; g 'async void' | head -5
echo "### EF  AsNoTracking=$(count 'AsNoTracking')  ToListAsync=$(count 'ToListAsync\(')  ToListAsync(ct)=$(count 'ToListAsync\([a-zA-Z]')  SaveChangesAsync=$(count 'SaveChangesAsync\(')  SaveChangesAsync(ct)=$(count 'SaveChangesAsync\([a-zA-Z]')  CancellationToken=$(count 'CancellationToken')  BeginTransaction=$(count 'BeginTransaction')  ExecuteUpdate/Delete=$(count 'Execute(Update|Delete)Async')  HasQueryFilter=$(count 'HasQueryFilter')"
echo "### http/di  new HttpClient=$(count 'new HttpClient\(')  AddHttpClient=$(count 'AddHttpClient')  IHttpClientFactory=$(count 'IHttpClientFactory')  IConfiguration-injected=$(count 'IConfiguration [a-z]')  IOptions=$(count 'IOptions(Snapshot|Monitor)?<')  IServiceScopeFactory=$(count 'IServiceScopeFactory')"
echo "### exceptions  'throw new Exception('=$(count 'throw new Exception\(')  'throw ex;'=$(count 'throw [a-z]+;')  'catch (Exception'=$(count 'catch \(Exception')  catch-total=$(count '\bcatch\b')  'when ('=$(count 'catch \(.*\) when')  ThrowIf=$(count 'ThrowIf')  '?? throw'=$(count '\?\? throw')"
echo "custom exceptions:"; g 'class [A-Za-z]+Exception'
echo "global handler:"; g 'IExceptionHandler|UseExceptionHandler|AddProblemDetails|UseDeveloperExceptionPage' | head -5
echo "### results  Results.=$(count '\bResults\.')  TypedResults.=$(count 'TypedResults\.')  Problem=$(count 'Results\.Problem')  NotFound=$(count 'Results\.NotFound')  BadRequest=$(count 'Results\.BadRequest')  Conflict=$(count 'Results\.Conflict')  'new { error'=$(count 'new \{ error')"
echo "### api shape  controllers=$(g -l ': ControllerBase|\[ApiController\]' | wc -l)  MapGroup=$(count 'MapGroup\(')  Map{Verb}=$(count 'Map(Get|Post|Put|Delete|Patch)\(')  JsonStringEnumConverter=$(count 'JsonStringEnumConverter')"
echo "### comments  <summary>=$(count '<summary>')  <remarks>=$(count '<remarks>')  inline //=$(count '^\s*//[^/]')  TODO/FIXME=$(count '//\s*(TODO|FIXME|HACK)')  types=$(count '^(public|internal) (sealed |static |abstract |partial )*(class|record|interface|enum)')  types-with-header-comment=$(g -B1 '^(public|internal) (sealed |static |abstract |partial )*(class|record|interface|enum)' | grep -cE '^\S+-\s*//')"
echo "random inline comments:"; g '^\s*//[^/]' | shuf -n 8 --random-source=<(yes)
echo "### tests  Fact=$(count '\[Fact')  Theory=$(count '\[Theory')  WebApplicationFactory=$(count 'WebApplicationFactory')  bUnit=$(count 'Bunit')"
