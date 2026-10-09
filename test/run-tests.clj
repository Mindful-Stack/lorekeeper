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

;; Scenarios assert on what a command prints before it writes. Pin the permission mode (the
;; user's own default may auto-approve), allow only reading tools and node (every adr-lint and
;; doctor call), and deny writes, git and gh outright. Node can still write, which is why the
;; scenarios run from a temp copy of the fixture.
(def allowed-tools ["Read" "Glob" "Grep" "Bash(node *)" "Task" "Agent" "Skill"])
(def disallowed-tools ["Write" "Edit" "NotebookEdit" "Bash(git *)" "Bash(gh *)"])

(defn run-test [{:keys [name prompt workdir expects rejects]} {:keys [workspace-root plugin-dir]}]
  (let [;; Always run from workspace root where settings.json has plugins enabled.
        ;; --plugin-dir loads this checkout's plugin code rather than the installed copy.
        _ (println (colorize :yellow "  Running:") prompt "(context:" workdir ")")
        {:keys [out err exit]} (apply shell {:dir workspace-root
                                              :out :string
                                              :err :string
                                              :continue true}
                                     (concat ["claude" "--print" "--permission-mode" "default"
                                              "--allowedTools"] allowed-tools
                                             ["--disallowedTools"] disallowed-tools
                                             (when plugin-dir ["--plugin-dir" plugin-dir])
                                             ["--" prompt]))
        output (str out err)
        missing (filter #(not (re-find (re-pattern %) output)) expects)
        present (filter #(re-find (re-pattern %) output) (or rejects []))]
    {:name name
     :passed (and (empty? missing) (empty? present))
     :missing missing
     :present present
     :output output}))

(defn print-result [{:keys [name passed missing present]}]
  (if passed
    (println (colorize :green "[PASS]") name)
    (println (colorize :red "[FAIL]") name
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

(defn -main [& args]
  (let [opts (parse-args args)
        filter-name (:filter opts)
        verbose (contains? opts :verbose)
        scenarios (cond->> (load-scenarios)
                    filter-name (filter #(str/includes? (:name %) filter-name)))
        fixture (fixture-dir)
        copy (when (and (not (:workspace-root opts)) fixture) (copy-fixture fixture))
        env {:workspace-root (or (:workspace-root opts) (:root copy) (parent-workspace-root))
             :plugin-dir (or (:plugin-dir opts) (plugin-root))}
        all-passed (try
                     (println "Running" (count scenarios) "tests...")
                     (println "Workspace root:" (:workspace-root env))
                     (println "Plugin dir:" (:plugin-dir env))
                     (println "")
                     (let [results (doall (map (fn [s]
                                                 (let [r (run-test s env)]
                                                   (print-result r)
                                                   (when (and verbose (not (:passed r)))
                                                     (println "\n--- Output ---")
                                                     (println (:output r))
                                                     (println "--- End ---\n"))
                                                   r))
                                               scenarios))
                           passed (count (filter :passed results))
                           total (count results)]
                       (println (str "\nResults: " passed "/" total " passed"))
                       (= passed total))
                     (finally
                       (when copy (fs/delete-tree (:temp-dir copy)))))]
    (System/exit (if all-passed 0 1))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
