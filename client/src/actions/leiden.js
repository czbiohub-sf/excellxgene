import { API } from "../globals";
import {
  postNetworkErrorToast,
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

function writableAnnotations(annoMatrix) {
  return annoMatrix.schema.annotations.obs.columns
    .filter((s) => s.writable)
    .map((s) => s.name);
}

export function requestLeiden() {
    return async (dispatch, getState) => {
      try {
        const state = getState();
        // get current embedding
        
        const { layoutChoice, Leiden, annoMatrix, controls } = state;
        const { wsLeiden } = controls;
        const { res } = Leiden;
        let cells = annoMatrix.rowIndex.labels();
        cells = Array.isArray(cells) ? cells : Array.from(cells);          
        
        const annos = writableAnnotations(annoMatrix)
        const nums = [];
        annos.forEach((item)=>{
          if (item.startsWith("leiden_v")){
            nums.push(parseInt(item.split("leiden_v").at(-1).split("_").at(0)));
          }
        })
        const latest = nums.reduce(function(a, b) {
            return Math.max(a, b);
        }, 0)+1;
        const name = `leiden_v${latest}_r${Math.round((res+Number.EPSILON)*1000)/1000.0}`
        wsLeiden.send(JSON.stringify({
          name: layoutChoice.current,
          cName: name,
          resolution: res,
          filter: { obs: { index: cells } }    
        }))
        dispatch({
          type: "leiden: request start"
        });
      } catch (error) {
        dispatch({
          type: "leiden: request aborted",
        });
        if (error.name === "AbortError") {
          postAsyncFailureToast("Leiden clustering was aborted.");
        } else {
          postNetworkErrorToast(`Leiden: ${error.message}`);
        }
        console.log("Leiden exception:", error, error.name, error.message);
      }
    };
}
  