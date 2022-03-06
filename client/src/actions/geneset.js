export const genesetDelete = (genesetDescription, genesetName) => (dispatch, getState) => {
  const state = getState();
  const { genesets } = state;
  const gs = genesets?.genesets?.[genesetDescription] ?? {};
  const geneSymbols = gs?.[genesetName] ?? [];
  const obsCrossfilter = dropGeneset(dispatch, state, genesetDescription, genesetName, geneSymbols);
  dispatch({
    type: "color by nothing"
  });  
  dispatch({
    type: "geneset: delete",
    genesetDescription,
    genesetName,
    obsCrossfilter,
    annoMatrix: obsCrossfilter.annoMatrix,
  });
};
export const genesetDeleteGroup = (genesetGroup) => (dispatch, getState) => {
  const state = getState();
  const obsCrossfilter = dropGenesets(dispatch, state, genesetGroup);
  dispatch({
    type: "color by nothing"
  });  
  dispatch({
    type: "geneset: group delete",
    genesetDescription: genesetGroup,
    obsCrossfilter,
    annoMatrix: obsCrossfilter.annoMatrix,
  });
};
export const genesetAddGenes = (genesetDescription, genesetName, genes) => (dispatch, getState) => {
  const state = getState();
  const { obsCrossfilter: prevObsCrossfilter, controls } = state;
  const { allGenes } = controls;
  const obsCrossfilter = dropGenesetSummaryDimension(
    prevObsCrossfilter,
    state,
    genesetDescription,
    genesetName
  );
  dispatch({
    type: "continuous metadata histogram cancel",
    continuousNamespace: { isGeneSetSummary: true },
    selection: `${genesetDescription}::${genesetName}`,
  });  
  return dispatch({
    type: "geneset: add genes",
    genesetDescription,
    genesetName,
    genes: genes.filter((item)=>allGenes.__columns[0].includes(item)),
    obsCrossfilter,
    annoMatrix: obsCrossfilter.annoMatrix,
  });
};

export const genesetDeleteGenes = (genesetDescription, genesetName, geneSymbols) => (
  dispatch,
  getState
) => {
  const state = getState();
  const obsCrossfilter = dropGeneset(dispatch, state, genesetDescription, genesetName, geneSymbols);
  return dispatch({
    type: "geneset: delete genes",
    genesetDescription,
    genesetName,
    geneSymbols,
    obsCrossfilter,
    annoMatrix: obsCrossfilter.annoMatrix,
  });
};

/*
Private
*/

function dropGenesetSummaryDimension(obsCrossfilter, state, genesetDescription, genesetName) {
  const { annoMatrix, genesets } = state;
  const varIndex = annoMatrix.schema.annotations?.var?.index;
  const gs = genesets?.genesets?.[genesetDescription] ?? {};
  const genes = gs?.[genesetName] ?? [];
  const query = {
    summarize: {
      method: "mean",
      field: "var",
      column: varIndex,
      values: genes,
    },
  };
  return obsCrossfilter.dropDimension("X", query);
}

function dropGeneDimension(obsCrossfilter, state, gene) {
  const { annoMatrix } = state;
  const varIndex = annoMatrix.schema.annotations?.var?.index;
  const query = {
    where: {
      field: "var",
      column: varIndex,
      value: gene,
    },
  };
  return obsCrossfilter.dropDimension("X", query);
}

function dropGeneset(dispatch, state, genesetDescription, genesetName, geneSymbols) {
  const { obsCrossfilter: prevObsCrossfilter } = state;
  const obsCrossfilter = geneSymbols.reduce(
    (crossfilter, gene) => dropGeneDimension(crossfilter, state, gene),
    dropGenesetSummaryDimension(prevObsCrossfilter, state, genesetDescription, genesetName)
  );
  dispatch({
    type: "continuous metadata histogram cancel",
    continuousNamespace: { isGeneSetSummary: true },
    selection: `${genesetDescription}::${genesetName}`,
  });
  geneSymbols.forEach((g) =>
    dispatch({
      type: "continuous metadata histogram cancel",
      continuousNamespace: { isUserDefined: true },
      selection: g,
    })
  );
  return obsCrossfilter;
}
function dropGenesets(dispatch, state, group) {
  const { obsCrossfilter: prevObsCrossfilter, geneset } = state;
  let obsCrossfilter = prevObsCrossfilter;
  const gs = geneset?.[group] ?? {};
  for (const [genesetName,geneSymbols] of Object.entries(gs)) {    
    obsCrossfilter = geneSymbols.reduce(
      (crossfilter, gene) => dropGeneDimension(crossfilter, state, gene),
      dropGenesetSummaryDimension(obsCrossfilter, state, group, genesetName)
    );
    dispatch({
      type: "continuous metadata histogram cancel",
      continuousNamespace: { isGeneSetSummary: true },
      selection: `${group}::${genesetName}`,
    });
    geneSymbols.forEach((g) =>
      dispatch({
        type: "continuous metadata histogram cancel",
        continuousNamespace: { isUserDefined: true },
        selection: g,
      })
    );    
  }
  return obsCrossfilter;
}