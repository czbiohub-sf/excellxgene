import React from "react";
import { connect } from "react-redux";
import {
  Button,
  ButtonGroup,
  H4,
  Popover,
  Position,
  Radio,
  RadioGroup,
  AnchorButton,
  MenuItem,
  Slider,
  Menu,
  Icon,
  Tooltip,
} from "@blueprintjs/core";
import * as globals from "../../globals";
import actions from "../../actions";
import { getDiscreteCellEmbeddingRowIndex } from "../../util/stateManager/viewStackHelpers";
import AnnoDialog from "../annoDialog";
import LabelInput from "../labelInput";

@connect((state) => {
  return {
    layoutChoice: state.layoutChoice, // TODO: really should clean up naming, s/layout/embedding/g
    schema: state.annoMatrix?.schema,
    annoMatrix: state.annoMatrix,
    crossfilter: state.obsCrossfilter,
    userLoggedIn: state.controls.userInfo ? true : false,
    modifyingLayouts: state.controls.modifyingLayouts,
    cOrG: state.controls.cxgMode === "OBS" ? "cell" : "gene"
  };
})
class Embedding extends React.Component {
  constructor(props) {
    super(props);
    this.state = {newLayoutText: "", isEmbeddingExpanded: {"": true}, embeddingChoiceOpen: false, snapT: 1.0};
  }
  
  handleChangeOrSelect = (name) => {
    this.setState({
      newLayoutText: name,
    });
  };
  closeAllChildren = (node,tree,expanded) => {
    const children = tree[node]?.children;    
    if (children){
      expanded[node] = false;
      for (const child of children){
        this.closeAllChildren(child,tree,expanded)
      }
    }
  }
  handleEmbeddingExpansionChange = (e,node,val,tree) => {
    const { isEmbeddingExpanded: newExpanded } = this.state;
    if (val) {
      this.closeAllChildren(node,tree,newExpanded)
      this.setState({
        isEmbeddingExpanded: {...newExpanded}
      })      
    } else {
      this.setState({
        isEmbeddingExpanded: {...newExpanded, [node]: true}
      })
    }
    if(e){
      e.preventDefault()
    }
  }
  activateEditLayoutMode = (e, embeddingName) => {
    const { dispatch, userLoggedIn } = this.props;
    if (userLoggedIn) {
      this.setState({
        newLayoutText: embeddingName.split(';;').at(-1)
      })
      dispatch({
        type: "reembed: activate layout edit mode",
        data: embeddingName,
      });
    }
    e.preventDefault();
  };
  disableEditLayoutMode = () => {
    const { dispatch } = this.props;
    dispatch({
      type: "reembed: deactivate layout edit mode",
    });
  };
  handleEditLayout = (e) => {
    const { dispatch, layoutChoice } = this.props;
    const { newLayoutText, isEmbeddingExpanded } = this.state
    const { available } = layoutChoice;
    const toRename = [layoutChoice.layoutNameBeingEdited]
    available.forEach((item) => {
      if (item.includes(`${layoutChoice.layoutNameBeingEdited};;`)){
        toRename.push(item)
      }
    });
    const oldName = layoutChoice.layoutNameBeingEdited.split(';;').at(-1);
    const newName = newLayoutText;
    //#TODO: add a check for name validity, if invalid grey button
    toRename.forEach((item) => {
      const val = isEmbeddingExpanded?.[item] ?? false;
      this.setState({
        isEmbeddingExpanded: {...isEmbeddingExpanded, [item]: _, [item.replace(oldName,newName)]: val}
      })
    })
    if (oldName !== newName) {
      dispatch(actions.requestRenameEmbedding(toRename,oldName,newName))
    }
    dispatch({
      type: "reembed: deactivate layout edit mode",
    });       
  }
  shouldComponentUpdate = (nextProps, nextState) =>{
    if (!nextProps.modifyingLayouts){
      return true;
    } else {
      return !this.props.modifyingLayouts;
    }
  }

  handleLayoutChoiceChange = (e) => {
    const { dispatch, layoutChoice } = this.props;
    const { isEmbeddingExpanded } = this.state
    if (layoutChoice.available.includes(e.currentTarget.value) && !layoutChoice.isEditingLayoutName) {
      this.setState({
        isEmbeddingExpanded: {...isEmbeddingExpanded, [e.currentTarget.value]: true},
        embeddingChoiceOpen: false
      })
      dispatch(actions.reembedParamsObsmFetch(e.currentTarget.value));
      dispatch(actions.layoutChoiceAction(e.currentTarget.value));
      dispatch({type: "sankey: set alignment score threshold", threshold: 0})
    } 
  };

  handleDeleteEmbedding = (e,val) => {
    const { dispatch, annoMatrix, layoutChoice, userLoggedIn } = this.props;
    if (userLoggedIn) {
      const { available } = layoutChoice;
      const toDelete = [val]
      available.forEach((item) => {
        if (item.includes(`${val};;`)){
          toDelete.push(item)
        }
      });
      let newAnnoMatrix;
      toDelete.forEach((item) => {
        dispatch({type: "reembed: delete reembedding", embName: item})
        newAnnoMatrix = annoMatrix.dropObsmLayout(val);
        dispatch({type: "", annoMatrix: newAnnoMatrix})
      })
      dispatch(actions.requestDeleteEmbedding(toDelete))
    }
    e.preventDefault()    
  }
  render() {
    const { dispatch, layoutChoice, schema, crossfilter, cOrG } = this.props;
    const { newLayoutText, isEmbeddingExpanded, embeddingChoiceOpen, snapT } = this.state;
    const { annoMatrix } = crossfilter;
    document.querySelector(".bp3-slider-label")?.remove()
    return (
      <ButtonGroup
        style={{
          position: "absolute",
          display: "inherit",
          left: 8,
          bottom: 8,
          zIndex: 9999,
        }}
      >
        <Popover
          isOpen={embeddingChoiceOpen}
          target={
            <Tooltip
              content="Select embedding for visualization"
              position="top"
              hoverOpenDelay={globals.tooltipHoverOpenDelay}
            >
              <Button
                type="button"
                data-testid="layout-choice"
                icon="heatmap"
                // minimal
                id="embedding"
                style={{
                  cursor: "pointer",
                }}
                onClick = {()=>this.setState({embeddingChoiceOpen: !embeddingChoiceOpen})}
              >
                {layoutChoice?.current.split(";;").at(-1)}: {crossfilter.countSelected()} out of{" "}
                {crossfilter.size()} {cOrG}s
              </Button>
            </Tooltip>
          }
          // minimal /* removes arrow */
          position={Position.TOP_LEFT}
          content={
            <div
              style={{
                display: "flex",
                justifyContent: "flex-start",
                alignItems: "flex-start",
                flexDirection: "column",
                padding: 10,
                width: 400,
                maxHeight: "375px",
                overflowY: "auto"                
              }}
            >
              <H4>Embedding Choice</H4>
              <p style={{ fontStyle: "italic" }}>
                There are {schema?.dataframe?.nObs} {cOrG}s in the entire dataset.
              </p>
              <EmbeddingChoices
                onChange={this.handleLayoutChoiceChange}
                annoMatrix={annoMatrix}
                layoutChoice={layoutChoice}
                onDeleteEmbedding={this.handleDeleteEmbedding}
                activateEditLayoutMode={this.activateEditLayoutMode}
                isEmbeddingExpanded={isEmbeddingExpanded}
                handleEmbeddingExpansionChange={this.handleEmbeddingExpansionChange}
                initEmbeddings={annoMatrix.schema?.initial_embeddings ?? []}
                cOrG={cOrG}
              />            
              <AnnoDialog
                isActive={
                  layoutChoice.isEditingLayoutName
                }
                inputProps={{
                  "data-testid": `edit-layout-name-dialog`,
                }}
                primaryButtonProps={{
                  "data-testid": `submit-layout-edit`,
                }}
                title="Edit layout name"
                instruction={"Choose a new layout name"}
                cancelTooltipContent="Close this dialog without editing this layout."
                primaryButtonText="Edit layout name"
                text={layoutChoice.layoutNameBeingEdited}
                handleSubmit={this.handleEditLayout}
                handleCancel={this.disableEditLayoutMode}
                annoInput={
                  <LabelInput
                    label={newLayoutText}
                    inputProps={{
                      "data-testid": `edit-layout-name-text`,
                      leftIcon: "tag",
                      intent: "none",
                      autoFocus: true,
                    }}
                    onChange={this.handleChangeOrSelect}
                    onSelect={this.handleChangeOrSelect}                    
                    newLabelMessage="New layout name"
                  />
                }
              />              
            </div>
          }
        />
        <Slider
          min={0.0}
          max={1.0}
          stepSize={0.01}
          showTrackFill={false}
          onChange={(value)=>{
            this.setState({snapT: value})
            dispatch({type: "set snapT", value})}}
          value={snapT}
          onRelease={()=>{
            this.setState({snapT: 1.0})
            dispatch({type: "set snapT", value: 1.5})
          }}
          labelValues={[]}
          labelRenderer={null}
        />          
      </ButtonGroup>
    );
  }
}

export default Embedding;

const loadAllEmbeddingCounts = async (annoMatrix, available) => {
  const embeddings = await Promise.all(
    available.map((name) => {
      return annoMatrix.base().fetch("emb", name);
    })
  );
  try {
    return available.map((name, idx) => ({
      embeddingName: name,
      embedding: embeddings[idx],
      discreteCellIndex: getDiscreteCellEmbeddingRowIndex(embeddings[idx]),
    }));
  } catch {
    // nothing happens
  }
  
};

/*
below function will generate an array with full tree of embeddings.
but i only want to show PARENT+children, selecting parent should switch to parent's parent. if no parent, padding = 0

so i can use current indented embedding tree, but the node I give it is going to change based on user's selection.

*/

const IndentedEmbeddingTree = (node,roots,tree,padding, els, currView, onDeleteEmbedding, activateEditLayoutMode, isEmbeddingExpanded, handleEmbeddingExpansionChange, initEmbeddings) => {
  const children = tree[node]?.children;
  els.push(
    (isEmbeddingExpanded?.[tree[node].parent] ?? tree[tree[node].parent].expandedByDefault) ? <Radio
      label={`${node.split(';;').at(-1)}: ${tree[node].sizeHint}`}
      value={node}
      key={node}
      style={{
        display: "flex",
        verticalAlign: "middle",
        paddingLeft: `${padding+26}px`
      }}
      children={
      <div style={{
        paddingLeft: "5px",
      }}>
      {children && !(tree[node]?.disable ?? false) ? 
      <AnchorButton
        icon={isEmbeddingExpanded?.[node] ?? tree[node].expandedByDefault ? "chevron-down" : "chevron-right"}
        data-testid={`${node}:expand-embeddings`}
        onClick={(e) => handleEmbeddingExpansionChange(e,node,isEmbeddingExpanded?.[node] ?? tree[node].expandedByDefault, tree)}
        minimal
        style={{
          cursor: "pointer",
          marginLeft: "auto",
          marginTop: "-5px"
        }}                    
        /> : null}

        {(node !== "root" && !initEmbeddings.includes(node)) ?
      <Tooltip
        content="Edit embedding name"
        position="top"
        hoverOpenDelay={globals.tooltipHoverOpenDelay}      
      >
      <AnchorButton
          icon={<Icon icon="edit" iconSize={10} />}     
          data-testid={`${node}:edit-layout-mode`}
          onClick={(e) => activateEditLayoutMode(e,node)}
          minimal
          style={{
            cursor: "pointer",
            marginLeft: "auto",
            marginTop: "-5px"
          }}                    
        /></Tooltip> : null}
        {(node !== currView && node !== "root"  && !roots.includes(node) && !initEmbeddings.includes(node))?
        <Tooltip
        content="Delete embedding"
        position="top"
        hoverOpenDelay={globals.tooltipHoverOpenDelay}
        >
        <AnchorButton
        icon={<Icon icon="trash" iconSize={10} />}     
          minimal
          intent="danger"
          style={{
            cursor: "pointer",
            marginLeft: "auto",
            marginTop: "-5px"
          }}
          onClick={(e) => onDeleteEmbedding(e,node)}
        /> 
        </Tooltip>
        : null}  
      </div> 
      }
    />  : null
  )  
  if (children){
    for (const child of children){
      IndentedEmbeddingTree(child,roots,tree,padding+26, els, currView, onDeleteEmbedding, activateEditLayoutMode, isEmbeddingExpanded, handleEmbeddingExpansionChange, initEmbeddings)
    }
  }
}

const EmbeddingChoices = ({ onChange, annoMatrix, layoutChoice, onDeleteEmbedding, activateEditLayoutMode, isEmbeddingExpanded, handleEmbeddingExpansionChange, initEmbeddings, cOrG }) => {
  const [ data, setData ] = React.useState(null)
  const [ renderedEmbeddingTree, setRenderedEmbeddingTree ] = React.useState(null)
  React.useEffect(() => {
    const { available } = layoutChoice;
    loadAllEmbeddingCounts(annoMatrix,available).then((res)=>{
      setData(res)
      if (res) {
        const name = layoutChoice.current;
        let parentName;
        if(name.includes(";;")){
          parentName = name.replace(`;;${name.split(";;").at(-1)}`,"")
        } else {
          parentName = "";
        }
    
        const embeddingTree = {}
        res.map((summary) => {
          const { discreteCellIndex, embeddingName: queryName } = summary;
          let queryParent;
          if(queryName.includes(";;")){        
            queryParent = queryName.replace(`;;${queryName.split(";;").at(-1)}`,"")
          } else {
            queryParent = "";
          }
          
          const sizeHint = `${discreteCellIndex.size()} ${cOrG}s`;
          // add queryName to children of queryParent
          if (embeddingTree?.[queryParent]?.children) { //if children exists on queryParent
            embeddingTree[queryParent].children.push(queryName)
          } else if (embeddingTree?.[queryParent]) { // if anything exists on queryParent
            embeddingTree[queryParent] = {...embeddingTree[queryParent], children: [queryName]}
          } else { // create new entry for queryParent
            embeddingTree[queryParent] = {children: [queryName]}
          }

          const expandedByDefault = (queryParent==="" || queryName === name);

          if (embeddingTree?.[queryName]){ // queryName exists in embeddingTree
            embeddingTree[queryName] = {...embeddingTree[queryName], sizeHint: sizeHint, expandedByDefault: expandedByDefault, parent: queryParent}
          } else {
            embeddingTree[queryName] = {sizeHint: sizeHint, expandedByDefault: expandedByDefault, parent: queryParent}
          }
        });      
        const els = []
        let iterable;
        let roots;
        if (parentName === ""){
          iterable = embeddingTree[""].children      
        } else {
          let currNode = parentName;
          let iterate = true;
          roots = [currNode]
          embeddingTree[currNode].expandedByDefault = true;
          embeddingTree[currNode].disable = true;
          while (iterate){
            if (embeddingTree[currNode].parent === ""){
              iterate=false;
            } else {
              currNode = embeddingTree[currNode].parent
              embeddingTree[currNode].expandedByDefault = true;
              embeddingTree[currNode].disable = true;
              roots.push(currNode)
            }
          }
          iterable = [currNode]
        }
        
        for (const c of iterable){
          IndentedEmbeddingTree(c,roots??iterable.filter((item)=>item!==c),embeddingTree,0, els, name, onDeleteEmbedding, activateEditLayoutMode, isEmbeddingExpanded, handleEmbeddingExpansionChange, initEmbeddings)    
        }
        setRenderedEmbeddingTree(
          <RadioGroup onChange={onChange} selectedValue={layoutChoice.current}>
            {els}
          </RadioGroup>
        );
      }
    })
  }, [annoMatrix, layoutChoice, isEmbeddingExpanded]);

  if (!data) {
    /* still loading, or errored out - just omit counts (TODO: spinner?) */
    return (
      <div>
        {null}
      </div>
    );
  }
  return renderedEmbeddingTree;

}






