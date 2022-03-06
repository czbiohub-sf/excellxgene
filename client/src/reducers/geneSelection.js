const GeneSelection = (state={}, action) => {
  switch (action.type) {    
    case "select gene": {
      return {
        ...state,
        [action.gene]: true
      }
    }
    case "unselect gene": {
      const s = state;
      delete s[action.gene];
      return s;
    }    
    case "select genes": {
      const s = state;
      action.genes.forEach((item)=>{
        s[item]= true
      })
      return s;
    }
    case "unselect genes": {
      const s = state;
      action.genes.forEach((item)=>{
        delete s[item]
      })
      return s;
    }        
    default: {
      return state;
    }
  }
};

export default GeneSelection;
