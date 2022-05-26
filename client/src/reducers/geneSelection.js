const GeneSelection = (state={genes: new Set(), genesets: new Set()}, action) => {
  switch (action.type) {    
    case "select gene": {
      return {
        genesets: new Set(),
        genes: state.genes.add(action.gene)
      }
    }
    case "select genes": {
      return {
        genesets: new Set(),
        genes: new Set([...state.genes, ...action.genes])
      }
    }    
    case "unselect gene": {
      state.genes.delete(action.gene)
      return state;
    }            
    case "clear gene selection": {
      return {genesets: new Set(), genes: new Set()}
    }
    case "select geneset": {
      return {
        genesets: state.genesets.add(action.geneset),
        genes: new Set()
      }
    }
    case "select genesets": {
      return {
        genes: new Set(),
        genesets: new Set([...state.genesets, ...action.genesets])
      }
    }    
    case "unselect geneset": {
      state.genesets.delete(action.geneset)
      return state;
    }            
    default: {
      return state;
    }
  }
};

export default GeneSelection;
