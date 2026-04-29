#!/usr/bin/env bb
(require '[babashka.process :refer [shell]]
         '[clojure.edn :as edn]
         '[clojure.string :as str]
         '[clojure.java.io :as io])

(def colors {:green "\u001b[32m" :red "\u001b[31m" :yellow "\u001b[33m" :reset "\u001b[0m"})

(defn colorize [color text]
  (str (colors color) text (colors :reset)))

;; Find the workspace root (parent of the plugin checkout)
(defn find-workspace-root []
  (let [script-dir (-> *file* io/file .getParentFile .getCanonicalPath)
        ;; Go up from lorekeeper/test to the workspace root that holds both
        ;; the plugin and the knowledge-base checkout
        root (-> script-dir (io/file "../..") .getCanonicalFile .getCanonicalPath)]
    root))

(def workspace-root (find-workspace-root))

;; Debug mode via .knowledge-debug file is available for manual debugging
;; but not used in automated tests. See scenarios.edn for details.
;; Future enhancement: implement file-based logging for deeper debugging.

(defn run-test [{:keys [name prompt workdir expects]}]
  (let [;; Always run from workspace root where settings.json has plugins enabled
        _ (println (colorize :yellow "  Running:") prompt "(context:" workdir ")")
        {:keys [out err exit]} (shell {:dir workspace-root
                                        :out :string
                                        :err :string
                                        :continue true}
                                       "claude" "--print" prompt)
        output (str out err)
        missing (filter #(not (re-find (re-pattern %) output)) expects)]
    {:name name
     :passed (empty? missing)
     :missing missing
     :output output}))

(defn print-result [{:keys [name passed missing]}]
  (if passed
    (println (colorize :green "[PASS]") name)
    (println (colorize :red "[FAIL]") name "- missing:" (str/join ", " missing))))

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
        _ (println "Running" (count scenarios) "tests...")
        _ (println "Workspace root:" workspace-root)
        _ (println "")
        results (doall (map (fn [s]
                              (let [r (run-test s)]
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
    (System/exit (if (= passed total) 0 1))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
