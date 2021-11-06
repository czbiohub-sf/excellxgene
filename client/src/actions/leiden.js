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

async function doLeidenFetch(dispatch, getState) {
    const state = getState();
    // get current embedding
    
    const { layoutChoice, Leiden, annoMatrix } = state;
    const { res } = Leiden;
    let cells = annoMatrix.rowIndex.labels();
    cells = Array.isArray(cells) ? cells : Array.from(cells);          
    
    const name = `leiden_${Math.round(new Date().getTime() / 1000).toString(16)}_r${Math.round((res+Number.EPSILON)*1000)/1000.0}`
    const af = abortableFetch(
      `${API.prefix}${API.version}leiden`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          name: layoutChoice.current,
          cName: name,
          resolution: res,
          filter: { obs: { index: cells } }    
        }),
        credentials: "include",
      },
      6000000 // 1 minute timeout
    );
    dispatch({
      type: "leiden: request start",
      abortableFetch: af,
    });
    const result = await af.ready();
  
    if (result.ok && result.headers.get("Content-Type").includes("application/json")) {
      return [result,name];
    }
  
    // else an error
    let msg = `Unexpected HTTP response ${result.status}, ${result.statusText}`;
    const body = await result.text();
    if (body && body.length > 0) {
      msg = `${msg} -- ${body}`;
    }
    throw new Error(msg);
}

export function requestLeiden() {
    return async (dispatch, getState) => {
      try {
        const [res,name] = await doLeidenFetch(dispatch, getState);
        const leiden = await res.json();
        dispatch({
          type: "leiden: request completed",
        });

        return [leiden,name]
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
  