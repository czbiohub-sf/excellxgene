include ../../common.mk

.PHONY: clean
clean:
	rm -f common/web/templates/index.html
	rm -rf common/web/static
	rm -f common/web/csp-hashes.json

.PHONY: unit-test
unit-test:
	PYTHONWARNINGS=ignore:ResourceWarning coverage run \
		--source=app,auth,cli,common,compute,converters,data_anndata,data_common \
		--omit=.coverage,venv \
		-m unittest discover \
		--start-directory ../test/test_server/unit \
		--top-level-directory ../../ \
		--verbose; test_result=$$?; \
	exit $$test_result \

.PHONY: test-annotations-performance
test-annotations-performance:
	python ../test/test_server/performance/performance_test_annotations_backend.py

.PHONY: test-annotations-scale
test-annotations-scale:
	locust -f ../test/test_server/performance/scale_test_annotations.py --headless -u 30 -r 10 --host https://api.cellxgene.dev.single-cell.czi.technology/cellxgene/e/ --run-time 5m 2>&1 | tee locust_dev_stats.txt
