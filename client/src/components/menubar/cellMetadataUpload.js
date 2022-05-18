import React from "react";
import { Button, AnchorButton, H6, Dialog, Checkbox, InputGroup, Classes } from "@blueprintjs/core";
import { connect } from "react-redux";
import * as globals from "../../globals";
import {
  Dataframe,
} from "../../util/dataframe";

@connect((state) => ({
  annoMatrix: state.annoMatrix,
  schema: state.annoMatrix?.schema,
  obsCrossfilter: state.obsCrossfilter
}))
class CellMetadataUploadButton extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      uploadMetadataOpen: false,
      fileName: "Choose file..."
    };
  }
  
  resetFileState = () => {
    this.setState({...this.state, 
      fileName: "Choose file...", 
      uploadMetadataOpen: false,
      newAnnos: null,
      clashingAnnos: null,
      annoArrays: null,
      selectedAnnos: null,
      newAnnoNames: null,
      annoDtypes: null
    })
  }
  handleFileUpload = () => {
      let { obsCrossfilter: crossfilter, annoMatrix, dispatch } = this.props;
      const { annoArrays, annoDtypes, newAnnoNames, newAnnos, clashingAnnos, selectedAnnos } = this.state;
      const colIdx = [];
      const arrays = [];
      const dtypes= [];
      newAnnos.forEach((item,ix)=>{
        if (selectedAnnos?.[item] ?? true){
          let name;
          if (clashingAnnos?.[item]){
            name = newAnnoNames[item];
          } else {
            name = item;
          }
          colIdx.push(name);
          arrays.push(annoArrays[ix]);
          dtypes.push(annoDtypes[ix])
        }
      });

      arrays.forEach((arr,ix)=>{
        if (dtypes[ix] === "cat"){
          const item = new Array(arr);
          const df = new Dataframe([item[0].length,1],item)
          const { categories: cat } = df.col(0).summarizeCategorical();
          if (cat.length > 2000 && !isNaN(cat[0])){
            const item = new Float32Array(arr);
            const ctor = item.constructor;
            const newSchema = {
              name: colIdx[ix],
              type: "float32",
              writable: true,
            };      
            crossfilter = crossfilter.addObsColumn(
              newSchema,
              ctor,
              item
            );  
            annoMatrix = crossfilter.annoMatrix;
          } else {
            if (!cat.includes(globals.unassignedCategoryLabel)) {
                cat.push(globals.unassignedCategoryLabel);
              }
              const ctor = item.constructor;
              const newSchema = {
                name: colIdx[ix],
                type: "categorical",
                categories: cat,
                writable: true,
              };       
              crossfilter = crossfilter.addObsColumn(
                newSchema,
                ctor,
                arr
              );  
              annoMatrix = crossfilter.annoMatrix;
          }
        } else {
          const item = new Float32Array(arr);
          const ctor = item.constructor;
          const newSchema = {
            name: colIdx[ix],
            type: "float32",
            writable: true,
          };      
          crossfilter = crossfilter.addObsColumn(
            newSchema,
            ctor,
            item
          );  
          annoMatrix = crossfilter.annoMatrix;            
        } 
      });
      
    colIdx.forEach((item)=>{
      dispatch({
        type: "annotation: create category",
        data: item,
        categoryToDuplicate: null,
        annoMatrix,
        obsCrossfilter: crossfilter,
      });          
      dispatch({type: "track anno", anno: item})    

    })              
    this.resetFileState()
  }
  setupFileInput = () => {
    const context = this;
    const { schema } = this.props;

    function uploadDealcsv () {};
    uploadDealcsv.prototype.getCsv = function(e) {
      let input = document.getElementById('dealCsv');
      input.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            var myFile = this.files[0];
            var reader = new FileReader();
            context.setState({...context.state,fileName: myFile.name, uploadMetadataOpen: true})
            reader.addEventListener('load', function (e) {
                
                let csvdata = e.target.result; 
                parseCsv.getParsecsvdata(csvdata); // calling function for parse csv data 
            });
            
            reader.readAsBinaryString(myFile);
        }
      });
    }
    uploadDealcsv.prototype.getParsecsvdata = function(data) {
      let parsedata = [];

      let newLinebrk = data.split("\n");
      if (newLinebrk.at(-1)===""){
        newLinebrk = newLinebrk.slice(0,-1)
      }
      let numCols;
      for(let i = 0; i < newLinebrk.length; i++) {
        const x = newLinebrk[i].split("\t");
        if (numCols ?? false){
          if (x.length !== numCols || x.length === 1){
            context.resetFileState();
            throw new Error("TXT file improperly formatted");
          }
        }
        numCols = x.length;
        parsedata.push(x)
      }
      const colIdx = parsedata[0].slice(1);
      parsedata = parsedata.slice(1);
      const columns = [];
      const clashing = {};
      colIdx.forEach((item)=>{
        columns.push(new Map())
        if (schema.annotations.obsByName[item]) {
          clashing[item] = true;
        } else {
          clashing[item] = false;
        }
      })     
      const dtypes=[];
      parsedata.forEach((row,rowix)=>{
        row.slice(1).forEach((item,ix)=>{
          let dtype;
          if (!isNaN(item)){
            if (item.toString().indexOf('.') != -1){
              dtype="cont";
              columns[ix].set(row[0],parseFloat(item))
            } else {
              dtype="cat";
              columns[ix].set(row[0],parseInt(item))
            }
          } else {
            dtype="cat";
            columns[ix].set(row[0],item.toString())
          }
          if (rowix > 0){
            if (dtypes[ix] === "cont" && dtype !== "cont"){
              context.resetFileState();
              throw new Error("Each value in a continuous metadata column must be a float.");
            }
          } else {
            dtypes.push(dtype)
          }

        })
      })

      context.props.annoMatrix.fetch("obs", "name_0").then((nameDf)=>{
        const rowNames = nameDf.__columns[0];      
        const arrays = [];
        columns.forEach(()=>{
          arrays.push([])
        })
        rowNames.forEach((item) => {
          columns.forEach((map,ix)=>{
            if (dtypes[ix] === "cat"){
              arrays[ix].push(map.get(item) ?? "unassigned");
            } else {
              arrays[ix].push(map.get(item) ?? 0.0);
            }
          })
        })
        context.setState({...context.state, clashingAnnos: clashing, newAnnos: colIdx, annoArrays: arrays, annoDtypes: dtypes})        
      })
    }
    var parseCsv = new uploadDealcsv();
    parseCsv.getCsv();
  }
  
  validateNewLabels = () => {
    const { newAnnoNames, newAnnos, clashingAnnos, selectedAnnos} = this.state;
    const { schema } = this.props;
    if (!newAnnos){
      return false;
    } else {
      const names = [];
      for (const name of newAnnos) {
        if (clashingAnnos?.[name] && (selectedAnnos?.[name] ?? true)) {
          if (!newAnnoNames?.[name]) {
            return false;
          } else if (newAnnoNames?.[name] === "") {
            return false;
          }
          names.push(newAnnoNames?.[name])
        } else {
          names.push(name)
        }
      }
      for (const item of schema.annotations.obs.columns) {
        names.push(item.name)
      }
      for (const name of newAnnos) {
        if (names.indexOf(newAnnoNames?.[name]) !== names.lastIndexOf(newAnnoNames?.[name]) && (selectedAnnos?.[name] ?? true)
            && (selectedAnnos?.[newAnnoNames?.[name]] ?? true)
          ) {
          return false;
        }
      }
    }
    return true;
  }  
  render() {
    const {
      uploadMetadataOpen,
      clashingAnnos,
      newAnnos,
      selectedAnnos,
      newAnnoNames
    } = this.state;

    const disableLoad = !this.validateNewLabels();
    return (
    <>
        <input type="file" id="dealCsv" style={{display: "none"}}/>
        <Button minimal onClick={()=>{
          this.setupFileInput()
          const up = document.getElementById("dealCsv")
          up.click();
        }}>
          Cell metadata
        </Button>         
        <Dialog
        title="Upload metadata file (tab-delimited .txt)"
        isOpen={uploadMetadataOpen}
        onClose={()=>{
          this.resetFileState();
          }
        }
      >
        <div style={{
          display: "flex",
          flexDirection: "column",
          paddingLeft: "10px",
          paddingTop: "10px",
          width: "90%",
          margin: "0 auto"
        }}>      

          <div style={{display: "flex", flexDirection: "column"}}>
          {newAnnos ? 
            <div style={{paddingBottom: "10px"}}><hr/>
            <b>Select which annotations to load...</b></div> : null}  
          {newAnnos?.map((name,ix)=>{
            return (
              <div key={`${name}-anno-div`} style={{display: "flex", flexDirection: "row", justifyContent: "space-between", width: "60%"}}>
              <Checkbox key={`${name}-new-anno`} checked={selectedAnnos?.[name] ?? true} label={name}
                style={{margin: "auto 0", paddingRight: "10px"}}
                onChange={() => {
                    const sannos = selectedAnnos ?? {};
                    const {[name]: _, ...sannosExc } = sannos;
                    this.setState({...this.state,selectedAnnos: {[name]: !(sannos?.[name] ?? true), ...sannosExc}})
                  }
                } 
              />    
              {clashingAnnos?.[name] ? <InputGroup
                key={`${name}-input-cat`}
                id={`${name}-input-anno`}
                placeholder="Enter a unique name..."
                onChange={(e)=>{
                  const nan = newAnnoNames ?? {};
                  const {[name]: _, ...nanExc } = nan;   
                  this.setState({...this.state,newAnnoNames: {[name]: e.target.value, ...nanExc}})
                }}
                value={newAnnoNames?.[name] ?? ""}
              /> : null}      
              </div>                                          
            );
          }) ?? null}                   
          <br/>
          {newAnnos ? <AnchorButton
            intent={!disableLoad ? "primary" : "danger"}
            disabled={disableLoad}
            onClick={this.handleFileUpload}
            className={Classes.POPOVER_DISMISS}
          >
            {disableLoad ? "Label name collision": "Load"}
          </AnchorButton> : null}
          </div>
        </div>                                
      </Dialog>  
    </>       
    );
  }
}

export default CellMetadataUploadButton;
