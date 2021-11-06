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

async function doSankeyFetch(dispatch, getState) {
    const state = getState();
    // get current embedding
    const { layoutChoice, sankeySelection, annoMatrix } = state;
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
    dispatch({type: "sankey: set current cache key", key: `${catNames.join(";")}_${layoutChoice.current}`})
    if (`${catNames.join(";")}_${layoutChoice.current}` in cachedSankey) {
      return [cachedSankey[`${catNames.join(";")}_${layoutChoice.current}`],catNames]
    }

    const af = abortableFetch(
      `${API.prefix}${API.version}sankey`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          name: layoutChoice.current,
          labels: labels,
          filter: { obs: { index: cells } }
        }),
        credentials: "include",
      },
      6000000 // 10 minute timeout
    );
    dispatch({
      type: "sankey: request start",
      abortableFetch: af,
    });
    const res = await af.ready();
  
    if (res.ok && res.headers.get("Content-Type").includes("application/json")) {
      const sankey = await res.json();
      return [sankey,catNames];
    }
  
    // else an error
    let msg = `Unexpected HTTP response ${res.status}, ${res.statusText}`;
    const body = await res.text();
    if (body && body.length > 0) {
      msg = `${msg} -- ${body}`;
    }
    throw new Error(msg);
}

export function requestSankey() {
    return async (dispatch, getState) => {
      try {
        const { layoutChoice } = getState();
        const [sankey,catNames] = await doSankeyFetch(dispatch, getState);
        dispatch({
          type: "sankey: request completed",
        });
        dispatch({
          type: "sankey: cache results",
          sankey,
          key: `${catNames.join(";")}_${layoutChoice.current}`
        })
        return sankey      
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
  