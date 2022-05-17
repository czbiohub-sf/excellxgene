import { Html2Canvas } from "../../html2canvasPruned";

function addEventSimple(obj,evt,fn) {
	if (obj.addEventListener)
		obj.addEventListener(evt,fn,false);
	else if (obj.attachEvent)
		obj.attachEvent('on'+evt,fn);
}

function removeEventSimple(obj,evt,fn) {
	if (obj.removeEventListener)
		obj.removeEventListener(evt,fn,false);
	else if (obj.detachEvent)
		obj.detachEvent('on'+evt,fn);
}

const dragDrop = {
    initialMouseX: undefined,
    initialMouseY: undefined,
    startX: undefined,
    startY: undefined,
    draggedObject: undefined,
    initElement: function (element) {
        if (typeof element == 'string')
            element = document.getElementById(element);
        
        //document.body.children[1].children[0].children[0].appendChild(cloned)
        // I need to copy the DIV, make it lower opacity, and make it's position fixed with respect to my current mouse coordinates.
        element.onmousedown = dragDrop.startDragMouse;
        
    },
    startDragMouse: async function (e) {
        var evt = e || window.event;
        const H2C = new Html2Canvas();
        const canvas = await H2C.h2c.html2canvas(this)
        canvas.style.position="fixed";
        canvas.style.zOrder="1000000000";
        canvas.style.left=evt.clientX + "px";
        canvas.style.top=evt.clientY + "px";
        canvas.style.opacity=0.4
        document.body.appendChild(canvas)        

        dragDrop.startDrag(canvas);
        
        dragDrop.initialMouseX = evt.clientX;
        dragDrop.initialMouseY = evt.clientY;
        addEventSimple(document,'mousemove',dragDrop.dragMouse);
        addEventSimple(document,'mouseup',dragDrop.releaseElement);
        return false;
    },
    startDrag: function (obj) {
        if (dragDrop.draggedObject)
            dragDrop.releaseElement();
        dragDrop.startX = obj.offsetLeft;
        dragDrop.startY = obj.offsetTop;
        dragDrop.draggedObject = obj;
        obj.className += ' dragged';
    },
    dragMouse: function (e) {
        var evt = e || window.event;
        var dX = evt.clientX - dragDrop.initialMouseX;
        var dY = evt.clientY - dragDrop.initialMouseY;
        dragDrop.setPosition(dX,dY);
        return false;
    },
    setPosition: function (dx,dy) {
        dragDrop.draggedObject.style.left = dragDrop.startX + dx + 'px';
        dragDrop.draggedObject.style.top = dragDrop.startY + dy + 'px';
    },
    releaseElement: function() {
        removeEventSimple(document,'mousemove',dragDrop.dragMouse);
        removeEventSimple(document,'mouseup',dragDrop.releaseElement);
        dragDrop.draggedObject.className = dragDrop.draggedObject.className.replace(/dragged/,'');
        dragDrop.draggedObject = null;
    }
}    

export class DragDrop {

    constructor() {
        this.dragDrop = {...dragDrop};       
    }
}