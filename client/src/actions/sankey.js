import { API } from "../globals";
import {
  postNetworkErrorToast,
  postAsyncSuccessToast,
  postAsyncFailureToast,
} from "../components/framework/toasters";

function abortableFetch(request, opts, timeout = 0) {
  const controller = new AbortController();
  const { signal } = controller;

  return {
    abort: () => controller.abort(),
    isAborted: () => signal.aborted,
    ready: () => {
      if (timeout) {
        setTimeout(() => controller.abort(), timeout);
      }
      return fetch(request, { ...opts, signal });
    },
  };
}


export function requestSankey(threshold, params) {
    return async (dispatch, getState) => {
      try {
        const state = getState();
        const { layoutChoice, sankeySelection, annoMatrix, controls } = state;
        const { wsSankey } = controls;
        const { cachedSankey, selectedCategories } = sankeySelection;
        const labels = []
        const catNames = []
        for (const key of selectedCategories) {
          let t = await annoMatrix.fetch("obs",key)
          catNames.push(key)
          labels.push(Array.isArray(t.__columns[0]) ? t.__columns[0] : Array.from(t.__columns[0]))
        }
        if (labels.length === 1){
          labels.push(labels[0])
        }
        if (catNames.length === 2){
          catNames.sort()
        }
        
        let cells = annoMatrix.rowIndex.labels();
        cells = Array.isArray(cells) ? cells : Array.from(cells);
        const cacheString = `${catNames.join(";")}_${layoutChoice.current}_${params.samHVG}_${params.sankeyMethod}_${params.dataLayer}_${params.selectedGenes.join(";")}_${params.geneMetadata}`;
        dispatch({type: "sankey: set current cache key", key: cacheString})
        if (cacheString in cachedSankey) {
          return [cachedSankey[cacheString],catNames]
        }
        wsSankey.send(JSON.stringify({
          name: layoutChoice.current,
          labels: labels,
          filter: { obs: { index: cells } },
          params,
          catNames,
          threshold

        }));
        
        dispatch({
          type: "sankey: request start",
        });   
      } catch (error) {
        dispatch({
          type: "sankey: request aborted",
        });
        if (error.name === "AbortError") {
          postAsyncFailureToast("Sankey calculation was aborted.");
        } else {
          postNetworkErrorToast(`Sankey: ${error.message}`);
        }
        console.log("Sankey exception:", error, error.name, error.message);
      }
    };
}
  