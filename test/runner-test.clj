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

(let [{:keys [fail error]} (run-tests)]
  (System/exit (if (zero? (+ fail error)) 0 1)))
