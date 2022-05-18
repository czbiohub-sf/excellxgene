import * as html2canvas from 'html2canvas';

const html2canvasPruned = {
	addClassRecursively: function(element, className) {
		if (element.classList) {
			element.classList.add(className);
			if (element.children.length > 0) {
        for ( let i = 0; i < element.children.length; i+=1 ){
          const childElement = element.children[i];
          this.addClassRecursively(childElement, className);
        }
			}
		}
	},
	addWhiteListClass: function(elementContainer) {
		this.addClassRecursively(elementContainer, "export_whitelist_class");
		while (elementContainer) {
			if (elementContainer.classList) {
				elementContainer.classList.add("export_whitelist_class");
			}
			elementContainer = elementContainer.parentElement;
		}
	},
	removeWhiteListClass: function(element) { // Clean up afterwards.  Currently requires JQuery, but could be rewritten without it in the style of addWhiteListClass.
    if (typeof jQuery !== 'undefined') {
      jQuery(element).parents().addBack().removeClass('export_whitelist_class');
      jQuery(element).find('*').removeClass('export_whitelist_class');
    }
  },
  getStyleSheets: function() {
		var styleSheets = this.styleSheets;
		if (!styleSheets) {
			var fileNames = [".css"]; // Array of endings of names of css files that are needed
			styleSheets = Object.values(document.styleSheets).filter(function(sheet) {
				var fileLocation = sheet.href;
				if (fileLocation) {
					return !fileNames.every(function(fileName) {
						return !fileLocation.endsWith(fileName);
					})
				}
			});
			this.styleSheets = styleSheets;
		}
		return styleSheets;
	},
	copyStyles: function(destDocument) {
		var styleElement = destDocument.createElement("style");
		destDocument.body.appendChild(styleElement);
		var styleElementSheet = styleElement.sheet;

		this.getStyleSheets().forEach(function(styleSheet) {
      for (let i = 0; i < styleSheet.rules.length; i+=1) {
        styleElementSheet.insertRule(styleSheet.rules[i].cssText);
      }
		})
	},
  html2canvas: function(element) {
    this.addWhiteListClass(element);
    var that = this;
    return html2canvas(element, {
      scale: 1,
      ignoreElements: function(element) {
        if (element.classList && !element.classList.contains('export_whitelist_class')) {
          return true;
        }
        return false;
      },
      onclone: function(clonedDocument) {
        that.copyStyles(clonedDocument);
        that.removeWhiteListClass(element); 
      },

    })
  },
}

export class Html2Canvas {
    constructor() {
        this.h2c = {...html2canvasPruned};
    }
}