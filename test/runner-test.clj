#!/usr/bin/env bb
;; Self-test of run-tests.clj's :household overlay. Loading run-tests.clj defines its functions
;; without running -main (its last form runs -main only when it is the file bb was started with).
;; fixture-dir and plugin-root read *file* at call time; both files live in test/, so they resolve
;; the same directories from here.
(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.test :refer [deftest is run-tests]])

(load-file (str (fs/path (fs/parent (fs/absolutize *file*)) "run-tests.clj")))

(defn- manifest [dir]
  (json/parse-string (slurp (str (fs/path dir "household.json")))))

(deftest deep-merge-keeps-sibling-keys
  ;; Catches a shallow merge, which would replace the whole adr object.
  (is (= {"adr" {"localDir" "x" "allowSelfRatification" true} "k" 1}
         (deep-merge {"adr" {"localDir" "x"} "k" 1} {"adr" {"allowSelfRatification" true}}))))

(deftest household-overlay-lands-only-in-its-own-copy
  (let [fixture (fixture-dir)
        shared (atom nil)
        own (atom nil)]
    (try
      (reset! shared (copy-fixture fixture))
      (reset! own (household-copy fixture {"adr" {"allowSelfRatification" true}}))
      (let [shared @shared own @own]
      (is (true? (get-in (manifest (:root own)) ["adr" "allowSelfRatification"])))
      ;; the fixture's own keys survive the merge
      (is (= (get (manifest fixture) "repos") (get (manifest (:root own)) "repos")))
      (is (= "lore" (get (manifest (:root own)) "knowledge_base")))
      ;; neither the shared copy nor the bundled fixture sees the overlay
      (is (nil? (get (manifest (:root shared)) "adr")))
      (is (nil? (get (manifest fixture) "adr"))))
      (finally
        (when @own (fs/delete-tree (:temp-dir @own)))
        (when @shared (fs/delete-tree (:temp-dir @shared)))))))

(deftest keyword-keyed-overlay-merges-into-the-string-keyed-manifest
  (let [fixture (fixture-dir)
        copy (household-copy fixture {:adr {:allowSelfRatification true}})]
    (try
      (is (true? (get-in (manifest (:root copy)) ["adr" "allowSelfRatification"])))
      (is (= 1 (count (re-seq #"\"adr\"" (slurp (str (fs/path (:root copy) "household.json")))))))
      (finally
        (fs/delete-tree (:temp-dir copy))))))

(deftest a-passing-scenario-keeps-its-failing-runs-output
  ;; Catches the runner dropping a failing run's output when the scenario passes overall
  ;; (2/3 with --min 2): the saved file must hold that run's own output, not the passing one's.
  (let [outcomes (atom [{:name "s" :passed true :output "good run"}
                        {:name "s" :passed false :output "bad run" :present ["X"]}
                        {:name "s" :passed true :output "good run"}])
        r (with-redefs [run-test (fn [_ _] (let [o (first @outcomes)] (swap! outcomes rest) o))]
            (run-repeated {:name "s"} {} 3 2))]
    (try
      (is (true? (:passed r)))
      (is (= "2/3" (:tally r)))
      (is (= 1 (count (:failed-outputs r))))
      (is (= "bad run" (slurp (first (:failed-outputs r)))))
      (let [printed (with-out-str (print-result r))]
        ;; the reasons on the PASS line are the failing run's own
        (is (re-find #"\(a failing run - must not appear: X\)" printed))
        (is (re-find #"failing run's output: " printed)))
      (finally
        (run! fs/delete-if-exists (:failed-outputs r))))))

(deftest an-all-passing-scenario-saves-nothing
  (let [r (with-redefs [run-test (fn [_ _] {:name "s" :passed true :output "ok"})]
            (run-repeated {:name "s"} {} 2 2))]
    (is (true? (:passed r)))
    (is (empty? (:failed-outputs r)))))

(deftest a-log-reject-sees-global-flags-anywhere
  (let [log "--json story edit GRA-40 --version 1\nstory --json mv GRA-48 done\nstory ls --untriaged --json\n"]
    (is (= ["^story (?:edit|mv) "] (log-rejected ["^story (?:edit|mv) "] log)))
    (is (= ["^story ls --untriaged --json$"] (log-rejected ["^story ls --untriaged --json$"] log)))
    (is (empty? (log-rejected ["^comment add "] log)))))

(let [{:keys [fail error]} (run-tests)]
  (System/exit (if (zero? (+ fail error)) 0 1)))
