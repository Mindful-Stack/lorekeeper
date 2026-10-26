#!/usr/bin/env bb
(require '[babashka.process :refer [shell]]
         '[babashka.fs :as fs]
         '[clojure.edn :as edn]
         '[clojure.string :as str]
         '[clojure.java.io :as io])

(def colors {:green "\u001b[32m" :red "\u001b[31m" :yellow "\u001b[33m" :reset "\u001b[0m"})

(defn colorize [color text]
  (str (colors color) text (colors :reset)))

;; The bundled fixture workspace (household.json + a small KB with payments/inventory/device
;; domains), or nil when this checkout has none.
(defn fixture-dir []
  (let [fixture (io/file (-> *file* io/file .getParentFile .getCanonicalPath) "fixtures/workspace")]
    (when (.isDirectory fixture) (.getCanonicalPath fixture))))

;; Fallback for setups without the fixture that keep a real knowledge base as a sibling of
;; the plugin checkout.
(defn parent-workspace-root []
  (-> *file* io/file .getParentFile (io/file "../..") .getCanonicalFile .getCanonicalPath))

;; A fresh copy of the fixture in a temp directory outside any git repository, so nothing a
;; scenario runs (a node -e write, a backfill, a git command) can reach this checkout.
(defn copy-fixture [fixture]
  (let [dir (fs/create-temp-dir {:prefix "lorekeeper-scenarios-"})
        root (fs/path dir "workspace")]
    (fs/copy-tree fixture root)
    {:temp-dir (str dir) :root (str (fs/canonicalize root))}))

;; Debug mode via .knowledge-debug file is available for manual debugging
;; but not used in automated tests. See scenarios.edn for details.
;; Future enhancement: implement file-based logging for deeper debugging.

(defn plugin-root []
  (-> *file* io/file .getParentFile (io/file "..") .getCanonicalFile .getCanonicalPath))

;; Every scenario runs with an empty REEVE_CONFIG_DIR and without REEVE_URL, REEVE_TOKEN and
;; REEVE_BIN, so a real `reeve` on the PATH can never reach a server. A scenario that requires
;; "reeve-fake" also gets the fake planner first on the PATH and a fresh REEVE_FAKE_LOG, so no two
;; scenarios, repeats or mutation runs share a log. The scenario's own :env is merged last.
(defn scenario-env [{:keys [requires env]}]
  (let [config-dir (str (fs/create-temp-dir {:prefix "reeve-config-"}))
        fake? (some #{"reeve-fake"} requires)
        log (when fake? (str (fs/create-temp-file {:prefix "reeve-fake-" :suffix ".log"})))
        base (-> (into {} (System/getenv))
                 (dissoc "REEVE_URL" "REEVE_TOKEN" "REEVE_BIN")
                 (assoc "REEVE_CONFIG_DIR" config-dir))]
    {:env (merge (cond-> base
                   fake? (assoc "PATH" (str (plugin-root) "/test/fixtures/reeve-bin"
                                            java.io.File/pathSeparator (System/getenv "PATH"))
                                "REEVE_FAKE_LOG" log))
                 env)
     :log log
     :config-dir config-dir}))

(defn log-matches [patterns text]
  (filter #(re-find (re-pattern (str "(?m)" %)) text) patterns))

;; Scenarios assert on what a command prints before it writes. Pin the permission mode (the
;; user's own default may auto-approve), allow only reading tools and node (every adr-lint and
;; doctor call), and deny writes, git and gh outright. Node can still write, which is why the
;; scenarios run from a temp copy of the fixture.
(def allowed-tools ["Read" "Glob" "Grep" "Bash(node *)" "Task" "Agent" "Skill"])
(def disallowed-tools ["Write" "Edit" "NotebookEdit" "Bash(git *)" "Bash(gh *)"])

;; --plugin-dir loads this checkout's plugin code rather than the installed copy; the run starts
;; from the workspace root, where settings.json has plugins enabled.
(defn run-test [{:keys [name prompt workdir expects rejects log-expects log-rejects] :as scenario}
                {:keys [workspace-root plugin-dir]}]
  (let [{:keys [env log config-dir]} (scenario-env scenario)]
    (try
      (let [_ (println (colorize :yellow "  Running:") prompt "(context:" workdir ")")
            tools (distinct (concat allowed-tools (:allowed-tools scenario)))
            {:keys [out err]} (apply shell {:dir workspace-root :out :string :err :string
                                            :in "" :continue true :env env}
                                     (concat ["claude" "--print" "--permission-mode" "default"
                                              "--allowedTools"] tools
                                             ["--disallowedTools"] disallowed-tools
                                             (when plugin-dir ["--plugin-dir" plugin-dir])
                                             ["--" prompt]))
            output (str out err)
            log-text (if log (slurp log) "")
            missing (concat (filter #(not (re-find (re-pattern %) output)) expects)
                            (map #(str "log: " %)
                                 (remove (set (log-matches log-expects log-text)) log-expects)))
            present (concat (filter #(re-find (re-pattern %) output) (or rejects []))
                            (map #(str "log: " %) (log-matches log-rejects log-text)))]
        {:name name
         :passed (and (empty? missing) (empty? present))
         :missing missing
         :present present
         :output (cond-> output log (str "\n--- reeve fake log ---\n" log-text))})
      (finally
        (fs/delete-tree config-dir)
        (when log (fs/delete-if-exists log) (fs/delete-if-exists (str log ".state")))))))

(defn print-result [{:keys [name passed missing present tally]}]
  (if passed
    (println (colorize :green "[PASS]") name (or tally ""))
    (println (colorize :red "[FAIL]") name (or tally "")
             (str (when (seq missing) (str "- missing: " (str/join ", " missing)))
                  (when (seq present) (str " - must not appear: " (str/join ", " present)))))))

(defn load-scenarios []
  (let [script-dir (-> *file* io/file .getParentFile .getCanonicalPath)
        scenarios-file (str script-dir "/scenarios.edn")]
    (-> scenarios-file slurp edn/read-string)))

(defn parse-args [args]
  (loop [args args
         result {}]
    (if (empty? args)
      result
      (let [arg (first args)]
        (cond
          ;; --key=value format
          (and (str/starts-with? arg "--") (str/includes? arg "="))
          (let [[k v] (str/split (subs arg 2) #"=" 2)]
            (recur (rest args) (assoc result (keyword k) v)))

          ;; --key value format (check if next arg is a value)
          (str/starts-with? arg "--")
          (let [k (keyword (subs arg 2))
                next-arg (second args)]
            (if (and next-arg (not (str/starts-with? next-arg "--")))
              (recur (drop 2 args) (assoc result k next-arg))
              (recur (rest args) (assoc result k true))))

          ;; Skip positional args
          :else (recur (rest args) result))))))

;; --runs N runs each scenario N times and passes it when at least --min runs pass (default N),
;; so a flaky scenario shows its pass rate instead of hiding behind a lucky retry.
(defn run-repeated [s env runs min-pass]
  (let [rs (doall (repeatedly runs #(run-test s env)))
        k (count (filter :passed rs))]
    (assoc (or (first (remove :passed rs)) (first rs))
           :passed (>= k min-pass)
           :tally (when (> runs 1) (str k "/" runs)))))

(defn -main [& args]
  (let [opts (parse-args args)
        runs (parse-long (str (:runs opts "1")))
        min-pass (parse-long (str (:min opts runs)))
        filter-name (:filter opts)
        verbose (contains? opts :verbose)
        with (set (some-> (:with opts) str (str/split #",")))
        runnable? (fn [s] (every? with (:requires s)))
        selected (cond->> (load-scenarios)
                   filter-name (filter #(str/includes? (:name %) filter-name)))
        scenarios (filter runnable? selected)
        skipped (remove runnable? selected)
        fixture (fixture-dir)
        copy (when (and (not (:workspace-root opts)) fixture) (copy-fixture fixture))
        env {:workspace-root (or (:workspace-root opts) (:root copy) (parent-workspace-root))
             :plugin-dir (or (:plugin-dir opts) (plugin-root))}
        all-passed (try
                     (println "Running" (count scenarios) "tests...")
                     (println "Workspace root:" (:workspace-root env))
                     (println "Plugin dir:" (:plugin-dir env))
                     (println "")
                     (doseq [s skipped]
                       (println (colorize :yellow "[SKIP]") (:name s)
                                (str "(requires " (str/join ", " (:requires s))
                                     "; run with --with " (str/join "," (:requires s)) ")")))
                     (let [results (doall (map (fn [s]
                                                 (let [r (run-repeated s env runs min-pass)]
                                                   (print-result r)
                                                   (when (and verbose (not (:passed r)))
                                                     (println "\n--- Output ---")
                                                     (println (:output r))
                                                     (println "--- End ---\n"))
                                                   r))
                                               scenarios))
                           passed (count (filter :passed results))
                           total (count results)]
                       (println (str "\nResults: " passed "/" total " passed"
                                     (when (seq skipped) (str ", " (count skipped) " skipped"))))
                       (= passed total))
                     (finally
                       (when copy (fs/delete-tree (:temp-dir copy)))))]
    (System/exit (if all-passed 0 1))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
