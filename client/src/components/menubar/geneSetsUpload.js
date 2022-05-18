import React from "react";
import { Button, Classes } from "@blueprintjs/core";
import { connect } from "react-redux";
import actions from "../../actions";

@connect((state) => {
  return {
    genesets: state.genesets.genesets,
    annoMatrix: state.annoMatrix,
  };
})
class GeneSetsUpload extends React.Component {
  setupFileInput = () => {
    const { dispatch } = this.props;

    function uploadDealcsv () {};
    uploadDealcsv.prototype.getCsv = function(e) {
      let input = document.getElementById('dealCsv2');
      input.addEventListener('change', function() {
        if (this.files && this.files[0]) {

            var myFile = this.files[0];
            var reader = new FileReader();
            reader.addEventListener('load', function (e) {
                
                let csvdata = e.target.result; 
                parseCsv.getParsecsvdata(csvdata); // calling function for parse csv data 
            });
            
            reader.readAsBinaryString(myFile);
        }
      });
    }
    uploadDealcsv.prototype.getParsecsvdata = function(data) {
      const genesets = {};

      let newLinebrk = data.split("\n");
      if (newLinebrk.at(-1)===""){
        newLinebrk = newLinebrk.slice(0,-1)
      }

      for(let i = 0; i < newLinebrk.length; i++) {
        const y = newLinebrk[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
        const x = [];
        y.forEach((item)=>{
          if (item.startsWith("\"") && item.endsWith("\"")){
            x.push(item.substring(1,item.length-1).split("\r").at(0))
          } else {
            x.push(item.split("\r").at(0))
          }
        })
        if (x[0] === "gene_set_description" && x[1] === "gene_set_name"){
          continue;
        }
        const suffix = x[2]==="True" ? "" : "";
        if (`${x[0]}${suffix}` in genesets) {
          genesets[`${x[0]}${suffix}`][x[1]] = x.slice(3)
        } else {
          genesets[`${x[0]}${suffix}`]={}
          genesets[`${x[0]}${suffix}`][x[1]] = x.slice(3)
        }
      }
      for (const key1 in genesets) {
        for (const key2 in genesets[key1]) {
          dispatch({
            type: "geneset: create",
            genesetName: key2,
            genesetDescription: key1,
          });
          dispatch(actions.genesetAddGenes(key1, key2, genesets[key1][key2]));  
        }
      }
  

    }
    var parseCsv = new uploadDealcsv();
    parseCsv.getCsv();
  }

  render() {
    return (
      <>
        <input type="file" id="dealCsv2" style={{display: "none"}}/>
        <Button minimal className={Classes.POPOVER_DISMISS} onClick={()=>{
          this.setupFileInput()
          const up = document.getElementById("dealCsv2")
          up.click();
        }}>
          Gene sets
        </Button>  
      </> 
    );
  }
}

export default GeneSetsUpload;
