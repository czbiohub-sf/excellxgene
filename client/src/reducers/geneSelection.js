const GeneSelection = (state={genes: new Set()}, action) => {
  switch (action.type) {    
    case "select gene": {
      return {
        genes: state.genes.add(action.gene)
      }
    }
    case "select genes": {
      return {
        genes: new Set([...state.genes, ...action.genes])
      }
    }    
    case "unselect gene": {
      state.genes.delete(action.gene)
      return state;
    }            
    case "clear gene selection": {
      return {genes: new Set()}
    }
    default: {
      return state;
    }
  }
};

export default GeneSelection;
