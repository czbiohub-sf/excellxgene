import warnings
from datetime import datetime
import anndata
import numpy as np
from packaging import version
import pandas as pd
import scipy as sp
from pandas.core.dtypes.dtypes import CategoricalDtype
from scipy import sparse
from server_timing import Timing as ServerTiming
import time
import os
from glob import glob
import scanpy as sc
import scanpy.external as sce
from samalg import SAM
import backend.common.compute.diffexp_generic as diffexp_generic
from flask import jsonify, request, current_app, session, after_this_request, send_file
from backend.common.colors import convert_anndata_category_colors_to_cxg_category_colors
from backend.common.constants import Axis, MAX_LAYOUTS
from backend.server.common.corpora import corpora_get_props_from_anndata
from backend.common.errors import PrepareError, DatasetAccessError, FilterError
from backend.common.utils.type_conversion_utils import get_schema_type_hint_of_array
from anndata import AnnData
from backend.server.data_common.data_adaptor import DataAdaptor
from backend.common.fbs.matrix import encode_matrix_fbs
from multiprocessing import Pool
from functools import partial
import backend.server.common.rest as common_rest
import json
from backend.common.utils.utils import jsonify_numpy
import signal
import pickle
import pathlib
import base64
from hashlib import blake2b
from functools import wraps
from multiprocessing import shared_memory, resource_tracker
from os.path import exists
import sklearn.utils.sparsefuncs as sf
from numba import njit, prange
from numba.core import types
from numba.typed import Dict

anndata_version = version.parse(str(anndata.__version__)).release

def desktop_mode_only(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if current_app.hosted_mode:
            return jsonify({'message' : 'Feature only available in desktop mode.'}), 401
  
        return  f(*args, **kwargs)
  
    return decorated    

def auth0_token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = 'profile' in session
        # return 401 if token is not passed
        if not token and current_app.hosted_mode:
            return jsonify({'message' : 'Authorization missing.'}), 401
  
        return  f(*args, **kwargs)
  
    return decorated

def anndata_version_is_pre_070():
    major = anndata_version[0]
    minor = anndata_version[1] if len(anndata_version) > 1 else 0
    return major == 0 and minor < 7

def _callback_fn(res,ws,cfn,data,post_processing):
    if post_processing is not None:
        res = post_processing(res)
    d = {"response": res,"cfn": cfn}
    d.update(data)
    ws.send(jsonify_numpy(d))

def _multiprocessing_wrapper(da,ws,fn,cfn,data,post_processing,*args):
    _new_callback_fn = partial(_callback_fn,ws=ws,cfn=cfn,data=data,post_processing=post_processing)
    da.pool.apply_async(fn,args=args, callback=_new_callback_fn, error_callback=_error_callback)

def _error_callback(e):
    print("ERROR",e)
    
def compute_diffexp_ttest(shm,shm_csc,layer,tMean,tMeanSq,obs_mask_A,obs_mask_B,top_n,lfc_cutoff):
    to_remove = []
    a,ash,ad,b,bsh,bd,c,csh,cd,Xsh = shm_csc[layer]
    to_remove.extend([a,b,c])
    shm1 = shared_memory.SharedMemory(name=a)
    shm2 = shared_memory.SharedMemory(name=b)
    shm3 = shared_memory.SharedMemory(name=c)    
    indices =np.ndarray(ash,dtype=ad,buffer=shm1.buf)
    indptr = np.ndarray(bsh,dtype=bd,buffer=shm2.buf)
    data =   np.ndarray(csh,dtype=cd,buffer=shm3.buf)
    XI = sparse.csc_matrix((data,indices,indptr),shape=Xsh)    

    iA = np.where(obs_mask_A)[0]
    iB = np.where(obs_mask_B)[0]
    niA = np.where(np.invert(np.in1d(np.arange(XI.shape[0]),iA)))[0]
    niB = np.where(np.invert(np.in1d(np.arange(XI.shape[0]),iB)))[0]
    nA = iA.size
    nB = iB.size
    if (iA.size + iB.size) == XI.shape[0]:
        n = XI.shape[0]

        if iA.size < iB.size:
            meanA,meanAsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iA,niA)
            meanA/=nA
            meanAsq/=nA
            vA = meanAsq - meanA**2
            vA[vA<0]=0
            meanB = (tMean*n - meanA*nA) / nB
            meanBsq = (tMeanSq*n - meanAsq*nA) / nB
            vB = meanBsq - meanB**2                          
        else:
            meanB,meanBsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iB,niB)
            meanB/=nB
            meanBsq/=nB
            vB = meanBsq - meanB**2
            vB[vB<0]=0
            meanA = (tMean*n - meanB*nB) / nA
            meanAsq = (tMeanSq*n - meanBsq*nB) / nA
            vA = meanAsq - meanA**2  
    else:
        meanA,meanAsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iA,niA)
        meanA/=nA
        meanAsq/=nA
        vA = meanAsq - meanA**2
        vA[vA<0]=0

        meanB,meanBsq = _partial_summer(XI.data,XI.indices,XI.indptr,XI.shape[1],iB,niB)
        meanB/=nB
        meanBsq/=nB
        vB = meanBsq - meanB**2
        vB[vB<0]=0   

    _unregister_shm(to_remove)        
    return diffexp_generic.diffexp_ttest(meanA,vA,nA,meanB,vB,nB,top_n,lfc_cutoff)

def save_data(shm,shm_csc,AnnDataDict,labels,labelNames,currentLayout,obs_mask,userID):
    to_remove = []

    direc = pathlib.Path().absolute()        

    fnames = glob(f"{direc}/{userID}/emb/*.p")
    embs = {}
    nnms = {}
    params={}
    for f in fnames:
        n = f.split('/')[-1][:-2]
        if exists(f) and exists(f"{direc}/{userID}/nnm/{n}.p") and exists(f"{direc}/{userID}/params/{n}.p"):
            embs[n] = pickle.load(open(f,'rb'))
            nnms[n] = pickle.load(open(f"{direc}/{userID}/nnm/{n}.p",'rb'))
            params[n] = pickle.load(open(f"{direc}/{userID}/params/{n}.p",'rb'))
        else:
            if exists(f):
                embs[n] = pickle.load(open(f,'rb'))
    
    X = embs[currentLayout]
    f = np.isnan(X).sum(1)==0    
    filt = np.logical_and(f,obs_mask)

    a,ash,ad,b,bsh,bd,c,csh,cd,Xsh = shm["X"]
    to_remove.extend([a,b,c])
    shm1 = shared_memory.SharedMemory(name=a)
    shm2 = shared_memory.SharedMemory(name=b)
    shm3 = shared_memory.SharedMemory(name=c)    
    indices =np.ndarray(ash,dtype=ad,buffer=shm1.buf)
    indptr = np.ndarray(bsh,dtype=bd,buffer=shm2.buf)
    data =   np.ndarray(csh,dtype=cd,buffer=shm3.buf)
    X = sparse.csr_matrix((data,indices,indptr),shape=Xsh)    

    adata = AnnData(X = X[filt],
            obs = AnnDataDict["obs"][filt],
            var = AnnDataDict["var"])

    for k in AnnDataDict['varm'].keys():
        adata.varm[k] = AnnDataDict['varm'][k]

    name = currentLayout.split(';')[-1]

    if labels and labelNames:
        labels = [x['__columns'][0] for x in labels]
        for n,l in zip(labelNames,labels):
            if n != "name_0":
                adata.obs[n] = pd.Categorical(l)        

    keys = list(embs.keys())
    for k in keys:
        if name not in k.split(';;'):
            del embs[k]
            if k in nnms.keys():
                del nnms[k]
            if k in params.keys():
                del params[k]

    temp = {}
    for key in nnms.keys():
        temp[key] = nnms[key][filt][:,filt]
    for key in temp.keys():
        adata.obsp["N_"+key] = temp[key]
    for key in params.keys():
        adata.uns["N_"+key+"_params"]=params[key]
    for key in embs.keys():
        adata.obsm["X_"+key] = embs[key][filt] 

    keys = list(adata.var.keys())
    for k in keys:
        if ";;tMean" in k:
            del adata.var[k]
                
    try:
        adata.obs_names = pd.Index(adata.obs["name_0"].astype('str'))
        del adata.obs["name_0"]
    except:
        pass
    try:
        adata.var_names = pd.Index(adata.var["name_0"].astype('str'))
        del adata.var["name_0"]
    except:
        pass        

    for k in AnnDataDict["Xs"]:
        if k != "X":
            if not (shm["X"][0] == shm["orig.X"][0] and k=="orig.X"):
                a,ash,ad,b,bsh,bd,c,csh,cd,Xsh = shm[k]
                to_remove.extend([a,b,c])
                shm1 = shared_memory.SharedMemory(name=a)
                shm2 = shared_memory.SharedMemory(name=b)
                shm3 = shared_memory.SharedMemory(name=c)    
                indices =np.ndarray(ash,dtype=ad,buffer=shm1.buf)
                indptr = np.ndarray(bsh,dtype=bd,buffer=shm2.buf)
                data =   np.ndarray(csh,dtype=cd,buffer=shm3.buf)
                X = sparse.csr_matrix((data,indices,indptr),shape=Xsh)    
                adata.layers[k] = X[filt]

    adata.write_h5ad(f"{direc}/{userID}/{userID}_{currentLayout.replace(';','_')}.h5ad")
    _unregister_shm(to_remove)
    return f"{direc}/{userID}/{userID}_{currentLayout.replace(';','_')}.h5ad"

def compute_embedding(shm,shm_csc, AnnDataDict, reembedParams, parentName, embName, userID):    
    obs_mask = AnnDataDict['obs_mask']    
    with ServerTiming.time("layout.compute"):        
        adata = compute_preprocess(shm, shm_csc, AnnDataDict, reembedParams, userID)

        if adata.isbacked:
            raise NotImplementedError("Backed mode is incompatible with re-embedding")

        for k in list(adata.obsm.keys()):
            del adata.obsm[k]
        
        doSAM = reembedParams.get("doSAM",False)
        nTopGenesHVG = reembedParams.get("nTopGenesHVG",2000)
        nBinsHVG = reembedParams.get("nBins",20)
        doBatch = reembedParams.get("doBatch",False)
        batchMethod = reembedParams.get("batchMethod","Scanorama")
        batchKey = reembedParams.get("batchKey","")
        scanoramaKnn = reembedParams.get("scanoramaKnn",20)
        scanoramaSigma = reembedParams.get("scanoramaSigma",15)
        scanoramaAlpha = reembedParams.get("scanoramaAlpha",0.1)
        scanoramaBatchSize = reembedParams.get("scanoramaBatchSize",5000)
        bbknnNeighborsWithinBatch = reembedParams.get("bbknnNeighborsWithinBatch",3)
        numPCs = reembedParams.get("numPCs",150)
        pcaSolver = reembedParams.get("pcaSolver","randomized")
        neighborsKnn = reembedParams.get("neighborsKnn",20)
        neighborsMethod = reembedParams.get("neighborsMethod","umap")
        distanceMetric = reembedParams.get("distanceMetric","cosine")
        nnaSAM = reembedParams.get("nnaSAM",50)
        weightModeSAM = reembedParams.get("weightModeSAM","dispersion")
        umapMinDist = reembedParams.get("umapMinDist",0.1)
        scaleData = reembedParams.get("scaleData",False)

        if not doSAM:
            try:
                sc.pp.highly_variable_genes(adata,flavor='seurat_v3',n_top_genes=min(nTopGenesHVG,adata.shape[1]), n_bins=nBinsHVG)                
                adata = adata[:,adata.var['highly_variable']]                
            except:
                print('Error during HVG selection - some of your expressions are probably negative.')
            X = adata.X
            if scaleData:
                sc.pp.scale(adata,max_value=10)

            sc.pp.pca(adata,n_comps=min(min(adata.shape) - 1, numPCs), svd_solver=pcaSolver)
            adata.X = X
        else:            
            sam=SAM(counts = adata, inplace=True)
            X = sam.adata.X
            preprocessing = "StandardScaler" if scaleData else "Normalizer"
            sam.run(projection=None,npcs=min(min(adata.shape) - 1, numPCs), weight_mode=weightModeSAM,preprocessing=preprocessing,distance=distanceMetric,num_norm_avg=nnaSAM)
            sam.adata.X = X        
            adata=sam.adata

        if doBatch:
            if doSAM:
                adata_batch = sam.adata
            else:
                adata_batch = adata
            
            if batchMethod == "Harmony":
                sce.pp.harmony_integrate(adata_batch,batchKey,adjusted_basis="X_pca")
            elif batchMethod == "BBKNN":
                sce.pp.bbknn(adata_batch, batch_key=batchKey, metric=distanceMetric, n_pcs=numPCs, neighbors_within_batch=bbknnNeighborsWithinBatch)
            elif batchMethod == "Scanorama":
                sce.pp.scanorama_integrate(adata_batch, batchKey, basis='X_pca', adjusted_basis='X_pca',
                                    knn=scanoramaKnn, sigma=scanoramaSigma, alpha=scanoramaAlpha,
                                    batch_size=scanoramaBatchSize)               
            if doSAM:
                sam.adata = adata_batch
            else:
                adata = adata_batch

        if not doSAM or doSAM and batchMethod == "BBKNN":
            if not doBatch or doBatch and batchMethod != "BBKNN":
                sc.pp.neighbors(adata, n_neighbors=neighborsKnn, use_rep="X_pca",method=neighborsMethod, metric=distanceMetric)    
            sc.tl.umap(adata, min_dist=umapMinDist,maxiter = 500 if adata.shape[0] <= 10000 else 200)
        else:
            sam.run_umap(metric=distanceMetric,min_dist=umapMinDist)
            adata.obsm['X_umap'] = sam.adata.obsm['X_umap']
            adata.obsp['connectivities'] = sam.adata.obsp['connectivities']
            
        umap = adata.obsm["X_umap"]
        result = np.full((obs_mask.shape[0], umap.shape[1]), np.NaN)
        result[obs_mask] = umap
        X_umap,nnm = result, adata.obsp['connectivities']            

    if embName == "":
        embName = f"umap_{str(hex(int(time.time())))[2:]}"

    if parentName != "":
        parentName+=";;"
    
    name = f"{parentName}{embName}"
    if exists(f"{userID}/emb/{name}.p"):
        name = f"{name}_{str(hex(int(time.time())))[2:]}"
        
    dims = [f"{name}_0", f"{name}_1"]
    layout_schema = {"name": name, "type": "float32", "dims": dims}

    IXer = pd.Series(index =np.arange(nnm.shape[0]), data = np.where(obs_mask.flatten())[0])
    x,y = nnm.nonzero()
    d = nnm.data
    nnm = sp.sparse.coo_matrix((d,(IXer[x].values,IXer[y].values)),shape=(obs_mask.size,)*2).tocsr()

    direc = pathlib.Path().absolute()        
    if exists(f"{direc}/{userID}/params/latest.p"):
        latestPreParams = pickle.load(open(f"{direc}/{userID}/params/latest.p","rb"))
    else:
        latestPreParams = None

    if exists(f"{userID}/params/{parentName}.p"):
        parentParams = pickle.load(open(f"{direc}/{userID}/params/{parentName}.p","rb"))
    else:
        parentParams = None

    if latestPreParams is not None:
        for k in latestPreParams.keys():
            reembedParams[k] = latestPreParams[k]
            
    if (parentParams is not None):
        reembedParams[f"parentParams"]=parentParams

    reembedParams['sample_ids']=np.array(list(adata.obs_names))
    reembedParams['feature_ids']=np.array(list(adata.var_names))
    if doSAM:
        reembedParams['feature_weights']=np.array(list(sam.adata.var['weights']))
        
    pickle.dump(nnm, open(f"{direc}/{userID}/nnm/{name}.p","wb"))
    pickle.dump(X_umap, open(f"{direc}/{userID}/emb/{name}.p","wb"))
    pickle.dump(reembedParams, open(f"{direc}/{userID}/params/{name}.p","wb"))
    return layout_schema

def compute_leiden(obs_mask,name,resolution,userID):
    direc = pathlib.Path().absolute() 
    nnm = pickle.load(open(f"{direc}/{userID}/nnm/{name}.p","rb"))            
    nnm = nnm[obs_mask][:,obs_mask]

    X = nnm

    import igraph as ig
    import leidenalg

    adjacency = X
    sources, targets = adjacency.nonzero()
    weights = adjacency[sources, targets]
    if isinstance(weights, np.matrix):
        weights = weights.A1
    g = ig.Graph(directed=True)
    g.add_vertices(adjacency.shape[0])
    g.add_edges(list(zip(sources, targets)))
    try:
        g.es["weight"] = weights
    except BaseException:
        pass

    cl = leidenalg.find_partition(
        g, leidenalg.RBConfigurationVertexPartition, resolution_parameter=resolution,seed=0
    )
    result = np.array(cl.membership)
    clusters = np.array(["unassigned"]*obs_mask.size,dtype='object')
    clusters[obs_mask] = result.astype('str')
    return list(result)

def compute_sankey_df(labels, name, obs_mask, userID):
    def reducer(a, b):
        result_a, inv_ndx = np.unique(a, return_inverse=True)
        result_b = np.bincount(inv_ndx, weights=b)
        return result_a, result_b        
    def cantor(a,b):
        return ((a+b)*(a+b+1)/2+b).astype('int')
    def inv_cantor(z):
        w = np.floor((np.sqrt(8*z + 1) - 1)/2)
        t = (w**2 + w)/2
        y = (z-t).astype('int')
        x = (w-y).astype('int')
        return x,y
    
    direc = pathlib.Path().absolute() 
    nnm = pickle.load(open(f"{direc}/{userID}/nnm/{name}.p","rb"))              
    nnm = nnm[obs_mask][:,obs_mask]

    cl=[]
    clu = []
    rixers=[]
    unassigned_ints=[]
    for i,c in enumerate(labels):
        cl0 = np.array(['A'+str(i)+'_'+str(x).replace(' ','_').replace('(','_').replace(')','_') for x in c])
        clu0,cluc0 = np.unique(cl0,return_counts=True)
        ix = pd.Series(index=clu0,data=np.arange(clu0.size))
        cl0 = ix[cl0].values
        ll = np.arange(clu0.size)[clu0=="A"+str(i)+"_unassigned"]
        if ll.size > 0:
            unassigned_ints.append(ll[0])
        else:
            unassigned_ints.append(-1)
            
        rixers.append(pd.Series(data=clu0,index=np.arange(clu0.size)))                     
        clu0 = np.arange(clu0.size)
        clu.append((clu0,cluc0))
        cl.append(cl0)

    ps = []
    cs = []
    for i,cl1 in enumerate(cl[:-1]):
        j = i+1
        cl2 = cl[i+1]
        clu1,cluc1 = clu[i]
        clu2,cluc2 = clu[j]
        uint1 = unassigned_ints[i]
        uint2 = unassigned_ints[j]
        rixer1 = rixers[i]
        rixer2 = rixers[j]        
        
        ac = pd.Series(index=clu1,data=cluc1)
        bc = pd.Series(index=clu2,data=cluc2)

        ixer1 = pd.Series(data=np.arange(clu1.size),index=clu1)
        ixer2 = pd.Series(data=np.arange(clu2.size),index=clu2)

        xi,yi = nnm.nonzero()
        di = nnm.data

        px,py = cl1[xi],cl2[yi]
        filt = np.logical_and(px != uint1,py != uint2)
        px = px[filt]
        py = py[filt]
        dif = di[filt]

        p = cantor(px,py)

        keys,cluster_scores = reducer(p,dif)
        xc,yc = inv_cantor(keys)
        cluster_scores = cluster_scores / ac[xc].values

        xc=ixer1[xc].values
        yc=ixer2[yc].values

        CSIM = sp.sparse.coo_matrix((cluster_scores,(xc,yc)),shape=(clu1.size,clu2.size)).A


        xi,yi = nnm.nonzero()
        di = nnm.data

        px,py = cl2[xi],cl1[yi]
        filt = np.logical_and(px != uint2,py != uint1)
        px = px[filt]
        py = py[filt]
        dif = di[filt]

        p = cantor(px,py)

        keys,cluster_scores = reducer(p,dif)
        xc,yc = inv_cantor(keys)
        cluster_scores = cluster_scores / bc[xc].values


        xc=ixer2[xc].values
        yc=ixer1[yc].values

        CSIM2 = sp.sparse.coo_matrix((cluster_scores,(xc,yc)),shape=(clu2.size,clu1.size)).A


        CSIM = np.stack((CSIM,CSIM2.T),axis=2).min(2)
        x,y = CSIM.nonzero()
        d = CSIM[x,y]
        x,y = rixer1[clu1[x]].values,rixer2[clu2[y]].values
        ps.append(np.vstack((x,y)).T)
        cs.append(d)

    ps = np.vstack(ps)
    cs = np.concatenate(cs)
    ps = [list(x) for x in ps]
    cs = list(cs)        
    return {"edges":ps,"weights":cs}

def compute_preprocess(shm,shm_csc, AnnDataDict, reembedParams, userID):
    to_remove = []
    layers = AnnDataDict['Xs'] 
    obs = AnnDataDict['obs']
    root = AnnDataDict['X_root']
    obs_mask = AnnDataDict['obs_mask']
    
    kkk=layers[0]
    a,ash,ad,b,bsh,bd,c,csh,cd,Xsh = shm[kkk]
    to_remove.extend([a,b,c])
    shm1 = shared_memory.SharedMemory(name=a)
    shm2 = shared_memory.SharedMemory(name=b)
    shm3 = shared_memory.SharedMemory(name=c)    
    indices =np.ndarray(ash,dtype=ad,buffer=shm1.buf)
    indptr = np.ndarray(bsh,dtype=bd,buffer=shm2.buf)
    data =   np.ndarray(csh,dtype=cd,buffer=shm3.buf)
    X = sparse.csr_matrix((data,indices,indptr),shape=Xsh)[obs_mask]
    adata = AnnData(X=X,obs=obs[obs_mask])

    adata.layers[layers[0]] = X
    for k in layers[1:]:
        kkk=k
        a,ash,ad,b,bsh,bd,c,csh,cd,Xsh = shm[kkk]
        to_remove.extend([a,b,c])
        shm1 = shared_memory.SharedMemory(name=a)
        shm2 = shared_memory.SharedMemory(name=b)
        shm3 = shared_memory.SharedMemory(name=c)    
        indices =np.ndarray(ash,dtype=ad,buffer=shm1.buf)
        indptr = np.ndarray(bsh,dtype=bd,buffer=shm2.buf)
        data =   np.ndarray(csh,dtype=cd,buffer=shm3.buf)
        X = sparse.csr_matrix((data,indices,indptr),shape=Xsh)[obs_mask]       
        adata.layers[k] = X
    adata.obsm["X_root"] = root[obs_mask]

    doBatchPrep = reembedParams.get("doBatchPrep",False)
    batchPrepParams = reembedParams.get("batchPrepParams",{})
    batchPrepKey = reembedParams.get("batchPrepKey","")
    batchPrepLabel = reembedParams.get("batchPrepLabel","")

    doPreprocess = reembedParams.get("doPreprocess",False)
    minCountsCF = reembedParams.get("minCountsCF",0)
    minGenesCF = reembedParams.get("minGenesCF",0)
    minCellsGF = reembedParams.get("minCellsGF",0)
    maxCellsGF = reembedParams.get("maxCellsGF",100)
    minCountsGF = reembedParams.get("minCountsGF",0)
    logTransform = reembedParams.get("logTransform",False)
    dataLayer = reembedParams.get("dataLayer","X")
    sumNormalizeCells = reembedParams.get("sumNormalizeCells",False)
    
    cn = np.array(list(adata.obs["name_0"]))        
    filt = np.array([True]*adata.shape[0])
    if doBatchPrep and batchPrepKey != "" and batchPrepLabel != "":
        cl = np.array(list(adata.obs[batchPrepKey]))
        batches = np.unique(cl)
        adatas = []
        cns = []
        for k in batches:
            params = batchPrepParams[batchPrepKey].get(k,{})

            doPreprocess = params.get("doPreprocess",False)
            minCountsCF = params.get("minCountsCF",0)
            minGenesCF = params.get("minGenesCF",0)
            minCellsGF = params.get("minCellsGF",0)
            maxCellsGF = params.get("maxCellsGF",100)
            minCountsGF = params.get("minCountsGF",0)
            logTransform = params.get("logTransform",False)
            dataLayer = params.get("dataLayer","X")
            sumNormalizeCells = params.get("sumNormalizeCells",False)
            
            adata_sub = adata[cl==k].copy()
            adata_sub.obs_names = adata_sub.obs["name_0"]
            if dataLayer == "X":
                adata_sub_raw = adata_sub
                if dataLayer == "X" and "X" not in adata_sub_raw.layers.keys():
                    adata_sub_raw.layers["X"] = adata_sub_raw.X    
                adata_sub_raw.X = adata_sub_raw.layers[dataLayer]        
            else:
                adata_sub_raw = AnnData(X=adata_sub.layers[dataLayer])
                adata_sub_raw.var_names = adata_sub.var_names
                adata_sub_raw.obs_names = adata_sub.obs_names
                adata_sub_raw.obs = adata_sub.obs
                for key in adata_sub.var.keys():
                    adata_sub_raw.var[key] = adata_sub.var[key]   
            if doPreprocess:
                filt1,_ = sc.pp.filter_cells(adata_sub_raw,min_counts=minCountsCF, inplace=False)
                filt2,_ = sc.pp.filter_cells(adata_sub_raw,min_genes=minGenesCF, inplace=False)
                filt = np.logical_and(filt1,filt2)
                cns.extend(np.array(list(adata_sub_raw.obs["name_0"]))[filt])
                target_sum = np.median(np.array(adata_sub_raw.X[filt].sum(1)).flatten())
                a1,_=sc.pp.filter_genes(adata_sub_raw, min_counts=minCountsGF,inplace=False)
                a2,_=sc.pp.filter_genes(adata_sub_raw, min_cells=minCellsGF/100*adata_sub_raw.shape[0],inplace=False)
                a3,_=sc.pp.filter_genes(adata_sub_raw, max_cells=maxCellsGF/100*adata_sub_raw.shape[0],inplace=False)
                a = a1*a2*a3
                
                adata_sub_raw.X = adata_sub_raw.X.multiply(a.flatten()[None,:]).tocsr()

                if sumNormalizeCells:
                    sc.pp.normalize_total(adata_sub_raw,target_sum=target_sum)
                if logTransform:
                    try:
                        sc.pp.log1p(adata_sub_raw)  
                    except:
                        pass
            else: 
                cns.extend(np.array(list(adata_sub_raw.obs["name_0"])))

            adatas.append(adata_sub_raw)
        adata_raw = anndata.concat(adatas,axis=0,join="inner")
        filt = np.in1d(np.array(list(cn)),np.array(cns))
        temp = adata_raw.obs_names.copy()
        adata_raw.obs_names = adata_raw.obs["name_0"]
        adata_raw = adata_raw[cn]
        adata_raw.obs_names = temp
    else:
        if dataLayer == "X":
            adata_raw = adata.copy()
            if dataLayer == "X" and "X" not in adata_raw.layers.keys():
                adata_raw.layers["X"] = adata_raw.X    
            adata_raw.X = adata_raw.layers[dataLayer]        
        else:

            adata_raw = AnnData(X=adata.layers[dataLayer])
            adata_raw.var_names = adata.var_names
            adata_raw.obs_names = adata.obs_names
            adata_raw.obs = adata.obs
            for key in adata.var.keys():
                adata_raw.var[key] = adata.var[key]                
        if doPreprocess:
            filt1,_ = sc.pp.filter_cells(adata_raw,min_counts=minCountsCF, inplace=False)
            filt2,_ = sc.pp.filter_cells(adata_raw,min_genes=minGenesCF, inplace=False)
            filt = np.logical_and(filt1,filt2)
            target_sum = np.median(np.array(adata_raw.X[filt].sum(1)).flatten())
            a1,_=sc.pp.filter_genes(adata_raw, min_counts=minCountsGF,inplace=False)
            a2,_=sc.pp.filter_genes(adata_raw, min_cells=minCellsGF/100*adata_raw.shape[0],inplace=False)
            a3,_=sc.pp.filter_genes(adata_raw, max_cells=maxCellsGF/100*adata_raw.shape[0],inplace=False)
            a = a1*a2*a3
            
            adata_raw.X = adata_raw.X.multiply(a.flatten()[None,:]).tocsr()
            
            if sumNormalizeCells:
                sc.pp.normalize_total(adata_raw,target_sum=target_sum)
            if logTransform:
                try:
                    sc.pp.log1p(adata_raw) 
                except:
                    pass
        
    direc = pathlib.Path().absolute() 
   
    adata_raw.layers['X'] = adata_raw.X            
    doBatchPrep = reembedParams.get("doBatchPrep",False)
    batchPrepParams = reembedParams.get("batchPrepParams",{})
    batchPrepKey = reembedParams.get("batchPrepKey","")
    batchPrepLabel = reembedParams.get("batchPrepLabel","")

    doPreprocess = reembedParams.get("doPreprocess",False)
    minCountsCF = reembedParams.get("minCountsCF",0)
    minGenesCF = reembedParams.get("minGenesCF",0)
    minCellsGF = reembedParams.get("minCellsGF",0)
    maxCellsGF = reembedParams.get("maxCellsGF",100)
    minCountsGF = reembedParams.get("minCountsGF",0)
    logTransform = reembedParams.get("logTransform",False)
    dataLayer = reembedParams.get("dataLayer","X")
    sumNormalizeCells = reembedParams.get("sumNormalizeCells",False)

    prepParams = {
        "doBatchPrep":doBatchPrep,
        "batchPrepParams":batchPrepParams,
        "batchPrepKey":batchPrepKey,
        "batchPrepLabel":batchPrepLabel,
        "doPreprocess":doPreprocess,
        "minCountsCF":minCountsCF,
        "minGenesCF":minGenesCF,
        "minCellsGF":minCellsGF,
        "maxCellsGF":maxCellsGF,
        "minCountsGF":minCountsGF,
        "logTransform":logTransform,
        "dataLayer":dataLayer,
        "sumNormalizeCells":sumNormalizeCells,        
    }        
    pickle.dump(prepParams, open(f"{direc}/{userID}/params/latest.p","wb"))  
    _unregister_shm(to_remove) 
    return adata_raw

def _unregister_shm(to_remove):
    to_remove = list(np.unique(to_remove))
    already_deleted=[]
    for s in to_remove:
        if s not in already_deleted:
            resource_tracker.unregister("/"+s,"shared_memory")      
            already_deleted.append(s)     

def initialize_socket(da):
    sock = da.socket
    @sock.route("/diffexp")
    @auth0_token_required
    def diffexp(ws):
        while True:
            data = ws.receive()
            if data is not None:  
                data = json.loads(data)
                obsFilterA = data.get("set1", {"filter": {}})["filter"]
                obsFilterB = data.get("set2", {"filter": {}})["filter"]
                layer = data.get("layer","X")
                top_n = data.get("count", 100)
                lfc_cutoff = 0.01
                shape = da.get_shape()

                obs_mask_A = da._axis_filter_to_mask(Axis.OBS, obsFilterA["obs"], shape[0])
                obs_mask_B = da._axis_filter_to_mask(Axis.OBS, obsFilterB["obs"], shape[0])      

                tMean = da.data.var[f'{layer};;tMean'].values
                tMeanSq = da.data.var[f'{layer};;tMeanSq'].values                      

                _multiprocessing_wrapper(da,ws,compute_diffexp_ttest, "diffexp",data,None,da.shm_layers_csr,da.shm_layers_csc,layer,tMean,tMeanSq,obs_mask_A,obs_mask_B,top_n,lfc_cutoff)
    
    @sock.route("/reembedding")
    @auth0_token_required
    def reembedding(ws):
        while True:
            data = ws.receive()
            if data is not None:  
                data = json.loads(data)

                filter = data["filter"] if data else None
                reembedParams = data["params"] if data else {}
                parentName = data["parentName"] if data else ""
                embName = data["embName"] if data else None
    
                annotations = da.dataset_config.user_annotations        
                userID = f"{annotations._get_userdata_idhash(da)}"  
                layers = []
                if current_app.hosted_mode:
                    doBatchPrep = reembedParams.get("doBatchPrep",False)
                    batchPrepParams = reembedParams.get("batchPrepParams",{})
                    batchPrepKey = reembedParams.get("batchPrepKey","")
                    batchPrepLabel = reembedParams.get("batchPrepLabel","")
                    dataLayer = reembedParams.get("dataLayer","X")
                    if doBatchPrep and batchPrepKey != "" and batchPrepLabel != "":
                        cl = np.array(list(da.data.obs[batchPrepKey]))
                        batches = np.unique(cl)
                        for k in batches:
                            params = batchPrepParams[batchPrepKey].get(k,{})
                            k = params.get("dataLayer","X")
                            layers.append(k)
                    else:
                        layers.append(dataLayer)
                else:
                    dataLayer = reembedParams.get("dataLayer","X")
                    layers.append(dataLayer)
                layers = list(np.unique(layers))
                direc = pathlib.Path().absolute()  
                obs = pickle.load(open(f"{direc}/{userID}/obs.p",'rb'))

                obs['name_0'] = obs.index
                obs.index = pd.Index(np.arange(obs.shape[0]))
                AnnDataDict = {
                    "Xs": layers,
                    "obs": obs,
                    "X_root":da._obsm_init["X_root"],
                    "obs_mask": da._axis_filter_to_mask(Axis.OBS, filter["obs"], da.get_shape()[0])
                }

                def post_processing(res):
                    da.schema["layout"]["obs"].append(res)
                    return res

                _multiprocessing_wrapper(da,ws,compute_embedding, "reembedding",data,post_processing,da.shm_layers_csr,da.shm_layers_csc,AnnDataDict, reembedParams, parentName, embName, userID)
    """
    @sock.route("/preprocessing")
    @desktop_mode_only
    def preprocessing(ws):
        while True:
            data = ws.receive()
            if data is not None and not current_app.hosted_mode:  
                data = json.loads(data)

                filter = data["filter"] if data else None
                reembedParams = data["params"] if data else {}
    
                annotations = da.dataset_config.user_annotations        
                userID = f"{annotations._get_userdata_idhash(da)}"  

                layers = []
                doBatchPrep = reembedParams.get("doBatchPrep",False)
                batchPrepParams = reembedParams.get("batchPrepParams",{})
                batchPrepKey = reembedParams.get("batchPrepKey","")
                batchPrepLabel = reembedParams.get("batchPrepLabel","")
                dataLayer = reembedParams.get("dataLayer","X")
                if doBatchPrep and batchPrepKey != "" and batchPrepLabel != "":
                    cl = np.array(list(da.data.obs[batchPrepKey]))
                    batches = np.unique(cl)
                    for k in batches:
                        params = batchPrepParams[batchPrepKey].get(k,{})
                        k = params.get("dataLayer","X")
                        layers.append(k)
                else:
                    layers.append(dataLayer)
                layers = list(np.unique(layers))
                
                AnnDataDict = {
                    "Xs":layers,
                    "obs":da.data.obs,
                    "X_root":da._obsm_init["X_root"],
                    "obs_mask": da._axis_filter_to_mask(Axis.OBS, filter["obs"], da.get_shape()[0])
                }

                def post_processing(res):
                    if da.shm_layers_csr["X"][0] != da.shm_layers_csr["orig.X"][0]:
                        for j in [0,3,6]:
                            s = shared_memory.SharedMemory(name=da.shm_layers_csr["X"][j])
                            s.close()
                            s.unlink()     
                    if da.shm_layers_csc["X"][0] != da.shm_layers_csc["orig.X"][0]:
                        for j in [0,3,6]:
                            s = shared_memory.SharedMemory(name=da.shm_layers_csc["X"][j])
                            s.close()
                            s.unlink()                              
                    da.shm_layers_csr["X"] = res["X_shm"]                    
                    da.shm_layers_csc["X"] = res["X_shm_csc"]

                    da.data.X = res["X"]
                    da.data.layers["X"] = res["X"]
                    da.data.var["X;;tMean"] = res['mean']
                    da.data.var["X;;tMeanSq"] = res['meansq']
                    return da.get_schema()

                _multiprocessing_wrapper(da,ws,compute_preprocess, "preprocessing",data,post_processing,da.shm_layers_csr,da.shm_layers_csc,AnnDataDict,reembedParams,userID, False)
    """
    @sock.route("/sankey")
    def sankey(ws):
        while True:
            data = ws.receive()
            if data is not None:  
                data = json.loads(data)
                labels = data.get("labels", None)
                name = data.get("name", None)
                filter = data.get("filter",None)
                annotations = da.dataset_config.user_annotations        
                userID = f"{annotations._get_userdata_idhash(da)}"  

                obs_mask = da._axis_filter_to_mask(Axis.OBS, filter["obs"], da.get_shape()[0])
                _multiprocessing_wrapper(da,ws,compute_sankey_df, "sankey",data,None,labels, name, obs_mask, userID)              

    @sock.route("/downloadAnndata")
    @auth0_token_required
    def downloadAnndata(ws):
        while True:
            data = ws.receive()
            if data is not None:  
                data = json.loads(data)
                labels = data.get("labels",None)
                labelNames = data.get("labelNames",None)
                currentLayout = data.get("currentLayout",None)
                filter = data["filter"] if data else None

                shape = da.get_shape()
                obs_mask = da._axis_filter_to_mask(Axis.OBS, filter["obs"], shape[0])

                annotations = da.dataset_config.user_annotations        
                userID = f"{annotations._get_userdata_idhash(da)}" 
                
                layers = list(da.data.layers.keys())
                varm = {}
                for k in da.data.varm.keys():
                    varm[k] = da.data.varm[k]

                AnnDataDict={"Xs":layers,"obs":da.data.obs, "var": da.data.var, "varm": varm}

                _multiprocessing_wrapper(da,ws,save_data, "downloadAnndata",data,None,da.shm_layers_csr,da.shm_layers_csc,AnnDataDict,labels,labelNames,currentLayout,obs_mask,userID)

 
    @sock.route("/leiden")
    @auth0_token_required
    def leiden(ws):
        while True:
            data = ws.receive()
            if data is not None:  
                data = json.loads(data)
                name = data.get("name", None)
                resolution = data.get('resolution',1.0)
                filter = data.get('filter',None)
                annotations = da.dataset_config.user_annotations        
                userID = f"{annotations._get_userdata_idhash(da)}"  
                obs_mask = da._axis_filter_to_mask(Axis.OBS, filter["obs"], da.get_shape()[0])

                _multiprocessing_wrapper(da,ws,compute_leiden, "leiden",data,None,obs_mask,name,resolution,userID)

@njit(parallel=True)
def _partial_summer(d,x,ptr,m,inc,ninc, calculate_sq=True):
    htable = Dict.empty(
        key_type=types.int64,
        value_type=types.boolean,
    )    
    for i in inc:
        htable[i] = True
    
    for i in ninc:
        htable[i] = False
        
    res = np.zeros(m)
    res2 = np.zeros(m)
    for i in prange(m):
        di = d[ptr[i] : ptr[i+1]]
        xi = x[ptr[i] : ptr[i+1]]
        s=0
        if calculate_sq:
            s2 = 0
        for j in prange(xi.size):
            s += di[j] if htable[xi[j]] else 0
            if calculate_sq:
                s2 += di[j]**2 if htable[xi[j]] else 0
                
        res[i] = s
        if calculate_sq:
            res2[i] = s2
    return res,res2

@njit(parallel=True)
def _fmt_swapper(indices,indptr,data,n):#x,y,d,ptr):
    pair = np.zeros_like(indices)
    for i in prange(indptr.size):
        pair[indptr[i]:indptr[i+1]]=i

    indptr2 = np.zeros(n,dtype=indices.dtype)
    for i in range(indices.size):
        indptr2[indices[i]+1]+=1
    indptr2 = np.cumsum(indptr2)

    res = np.zeros_like(pair)
    dres = np.zeros_like(data)
    indptr3 = indptr2[:-1].copy()  
    for i in range(indices.size):
        j = indices[i]
        k = indptr3[j]
        res[k]=pair[i]
        dres[k]=data[i]
        indptr3[j]+=1
    return dres,res,indptr2

def fmt_swapper(X):
    import scipy as sp
    if X.getformat()=="csc":
        return sp.sparse.csr_matrix(_fmt_swapper(X.indices,X.indptr,X.data,X.shape[0]+1),shape=X.shape)
    elif X.getformat()=="csr":
        return sp.sparse.csc_matrix(_fmt_swapper(X.indices,X.indptr,X.data,X.shape[1]+1),shape=X.shape)

def _create_shm(X):
    shm = shared_memory.SharedMemory(create=True,size=X.nbytes)
    a = np.ndarray(X.shape, dtype = X.dtype, buffer = shm.buf)
    a[:] = X[:]
    return shm.name

def _create_shm_from_data(X):
    a = _create_shm(X.indices)
    b = _create_shm(X.indptr)
    c = _create_shm(X.data)    
    return (a,X.indices.shape,X.indices.dtype,b,X.indptr.shape,X.indptr.dtype,c,X.data.shape,X.data.dtype,X.shape)

"""
def _create_data_from_shm(a,ash,ad,b,bsh,bd,c,csh,cd,Xsh):
    import scipy as sp
    shm1 = shared_memory.SharedMemory(name=a)
    shm2 = shared_memory.SharedMemory(name=b)
    shm3 = shared_memory.SharedMemory(name=c)    
    indices =np.ndarray(ash,dtype=ad,buffer=shm1.buf)
    indptr = np.ndarray(bsh,dtype=bd,buffer=shm2.buf)
    data =   np.ndarray(csh,dtype=cd,buffer=shm3.buf)
    return sp.sparse.csr_matrix((data,indices,indptr),shape=Xsh)

def create_data_from_shm(r):
    return _create_data_from_shm(*r)
"""

def _initializer():
    signal.signal(signal.SIGINT, signal.SIG_IGN)

class AnndataAdaptor(DataAdaptor):

    def __init__(self, data_locator, app_config=None, dataset_config=None):
        super().__init__(data_locator, app_config, dataset_config)
        self.data = None
        self._create_pool()
        self._load_data(data_locator, root_embedding=app_config.root_embedding)    
        self._validate_and_initialize()

    def _create_pool(self):
        self.pool = Pool(os.cpu_count(), initializer=_initializer, maxtasksperchild=1)

    def cleanup(self):
        pass

    @staticmethod
    def pre_load_validation(data_locator):
        if data_locator.islocal():
            # if data locator is local, apply file system conventions and other "cheap"
            # validation checks.  If a URI, defer until we actually fetch the data and
            # try to read it.  Many of these tests don't make sense for URIs (eg, extension-
            # based typing).
            if not data_locator.exists():
                raise DatasetAccessError("does not exist")

    @staticmethod
    def file_size(data_locator):
        return data_locator.size() if data_locator.islocal() else 0

    @staticmethod
    def open(data_locator, app_config, dataset_config=None):
        return AnndataAdaptor(data_locator, app_config, dataset_config)

    def get_corpora_props(self):
        return corpora_get_props_from_anndata(self.data)

    def get_name(self):
        return "cellxgene anndata adaptor version"

    def get_library_versions(self):
        return dict(anndata=str(anndata.__version__))

    @staticmethod
    def _create_unique_column_name(df, col_name_prefix):
        """given the columns of a dataframe, and a name prefix, return a column name which
        does not exist in the dataframe, AND which is prefixed by `prefix`

        The approach is to append a numeric suffix, starting at zero and increasing by
        one, until an unused name is found (eg, prefix_0, prefix_1, ...).
        """
        suffix = 0
        while f"{col_name_prefix}{suffix}" in df:
            suffix += 1
        return f"{col_name_prefix}{suffix}"

    def compute_diffexp_ttest(self):
        pass

    def compute_embedding(self):
        pass

    def compute_sankey_df(self):
        pass

    def compute_leiden(self):
        pass

    def _alias_annotation_names(self):
        """
        The front-end relies on the existance of a unique, human-readable
        index for obs & var (eg, var is typically gene name, obs the cell name).
        The user can specify these via the --obs-names and --var-names config.
        If they are not specified, use the existing index to create them, giving
        the resulting column a unique name (eg, "name").

        In both cases, enforce that the result is unique, and communicate the
        index column name to the front-end via the obs_names and var_names config
        (which is incorporated into the schema).
        """
        self.original_obs_index = self.data.obs.index

        for (ax_name, var_name) in ((Axis.OBS, "obs"), (Axis.VAR, "var")):
            config_name = f"single_dataset__{var_name}_names"
            parameter_name = f"{var_name}_names"
            name = getattr(self.server_config, config_name)
            df_axis = getattr(self.data, str(ax_name))
            if name is None:
                # Default: create unique names from index
                if not df_axis.index.is_unique:
                    raise KeyError(
                        f"Values in {ax_name}.index must be unique. "
                        "Please prepare data to contain unique index values, or specify an "
                        "alternative with --{ax_name}-name."
                    )
                name = self._create_unique_column_name(df_axis.columns, "name_")
                self.parameters[parameter_name] = name
                # reset index to simple range; alias name to point at the
                # previously specified index.
                df_axis.rename_axis(name, inplace=True)
                df_axis.reset_index(inplace=True)
            elif name in df_axis.columns:
                # User has specified alternative column for unique names, and it exists
                if not df_axis[name].is_unique:
                    raise KeyError(
                        f"Values in {ax_name}.{name} must be unique. " "Please prepare data to contain unique values."
                    )
                df_axis.reset_index(drop=True, inplace=True)
                self.parameters[parameter_name] = name
            else:
                # user specified a non-existent column name
                raise KeyError(f"Annotation name {name}, specified in --{ax_name}-name does not exist.")

    def _create_schema(self):
        layers = list(self.data.layers.keys())
        
        if "X" not in layers:
            layers = ["X"] + layers
        
        self.schema = {
            "dataframe": {"nObs": self.cell_count, "nVar": self.gene_count, "type": str(self.data.X.dtype)},
            "annotations": {
                "obs": {"index": self.parameters.get("obs_names"), "columns": []},
                "var": {"index": self.parameters.get("var_names"), "columns": []},
            },
            "layout": {"obs": []},
            "layers": layers
        }
        for ax in Axis:
            curr_axis = getattr(self.data, str(ax))
            for ann in curr_axis:
                ann_schema = {"name": ann, "writable": True}
                ann_schema.update(get_schema_type_hint_of_array(curr_axis[ann]))
                if ann_schema['type']!='categorical':
                    ann_schema['writable']=False
                self.schema["annotations"][ax]["columns"].append(ann_schema)
        for layout in self.get_embedding_names():
            layout_schema = {"name": layout, "type": "float32", "dims": [f"{layout}_0", f"{layout}_1"]}
            self.schema["layout"]["obs"].append(layout_schema)

    def get_schema(self):
        return self.schema

    def _load_data(self, data_locator, root_embedding = None):
        # as of AnnData 0.6.19, backed mode performs initial load fast, but at the
        # cost of significantly slower access to X data.
        try:
            # there is no guarantee data_locator indicates a local file.  The AnnData
            # API will only consume local file objects.  If we get a non-local object,
            # make a copy in tmp, and delete it after we load into memory.
            with data_locator.local_handle() as lh:
                backed = "r" if self.server_config.adaptor__anndata_adaptor__backed else None

                if os.path.isdir(lh) and len(glob(lh+'/*.gz'))==0:
                    filenames = glob(lh+'/*')
                    adatas = []
                    batch = []
                    for file in filenames:
                        if os.path.isdir(file):
                            backed=False
                    
                    for file in filenames:
                        if os.path.isdir(file):
                            adata = sc.read_10x_mtx(file)
                            filt1,_ = sc.pp.filter_cells(adata,min_counts=100, inplace=False)
                            filt2,_ = sc.pp.filter_cells(adata,min_genes=100, inplace=False)
                            filt = np.logical_and(filt1,filt2)
                            adata = adata[filt].copy()
                        elif file.split('.')[-1] =='csv':
                            adata = sc.read_csv(file) 
                            adata.X = sp.sparse.csc_matrix(adata.X)
                        else:
                            adata = anndata.read_h5ad(file, backed=backed)

                        adatas.append(adata)
                        batch.append([file.split('.h5ad')[0].split('/')[-1]]*adata.shape[0])
                    adata = anndata.concat(adatas,join='inner',axis=0)
                    if "orig.ident" not in adata.obs.keys():
                        key = "orig.ident"
                    else:
                        key = f"orig.ident.{str(hex(int(time.time())))[2:]}"
                    adata.obs[key] = pd.Categorical(np.concatenate(batch))
                elif len(glob(lh+'/*.gz'))>0:
                    adata = sc.read_10x_mtx(lh)
                else:
                    adata = anndata.read_h5ad(lh, backed=backed)


                if not sparse.issparse(adata.X):
                    adata.X = sparse.csr_matrix(adata.X)

                for k in adata.layers.keys():  
                    if not sparse.issparse(adata.layers[k]):
                        adata.layers[k] = sparse.csr_matrix(adata.layers[k])

                if root_embedding is not None:
                    adata.obsm["X_root"] = adata.obsm[root_embedding]
                    if root_embedding[:2] == "X_":
                        obsp = root_embedding[2:]
                    else:
                        obsp = root_embedding
                    
                    if "N_"+obsp in adata.obsp.keys():
                        adata.obsp["N_root"] = adata.obsp["N_"+obsp]
                        adata.uns["N_root_params"] = adata.uns["N_"+obsp+"_params"]
                        del adata.obsp["N_"+obsp]
                        del adata.uns["N_"+obsp+"_params"]

                    del adata.obsm[root_embedding]
                else:
                    adata.obsm["X_root"] = np.zeros((adata.shape[0],2))
                
                adata.obs_names_make_unique()

                # cast all expressions to float32 if they're not already
                if adata.X.dtype != "float32":
                    adata.X = adata.X.astype('float32')
                for k in adata.layers.keys():
                    if adata.layers[k].dtype != "float32":
                        adata.layers[k] = adata.layers[k].astype('float32')

                self.shm_layers_csr = {}
                self.shm_layers_csc = {}
                if adata.X.getformat() == "csr":
                    self.shm_layers_csr["X"] = _create_shm_from_data(adata.X)
                    adata.X=fmt_swapper(adata.X)
                elif adata.X.getformat() != "csc":
                    adata.X=adata.X.tocsc()
                
                adata.layers["X"] = adata.X

                print("Loading and precomputing layers necessary for fast differential expression and reembedding...")
                
                # convert everything to CSC and cache all CSR into shared memory.
                shm_keys = list(self.shm_layers_csr.keys())
                for k in list(adata.layers.keys()):  
                    if k not in shm_keys:
                        if adata.layers[k].getformat() == "csr": # if csr, swap to csc and cache csr into shared memory.
                            self.shm_layers_csr[k] = _create_shm_from_data(adata.layers[k])
                            adata.layers[k] = fmt_swapper(adata.layers[k])
                        elif adata.layers[k].getformat() != "csc": # if any other format, just convert to csc.
                            adata.layers[k] = adata.layers[k].tocsc()
                                
                # cache all remaining CSC into CSR shared memory
                shm_keys = list(self.shm_layers_csr.keys())
                for key in list(adata.layers.keys()):
                    X = adata.layers[key]
                    if  key not in shm_keys: # if key not in shm_keys, then it means that it's CSC and didn't come from CSR.
                        X2 = fmt_swapper(X) # convert csc to csr
                        self.shm_layers_csr[key] = _create_shm_from_data(X2) #cache csr into shared memory

                    mean,v = sf.mean_variance_axis(X,axis=0)
                    meansq = v-mean**2
                    adata.var[f"{key};;tMean"] = mean
                    adata.var[f"{key};;tMeanSq"] = meansq
                
                for k in adata.layers.keys():
                    self.shm_layers_csc[k] = _create_shm_from_data(adata.layers[k])                    
                
                if 'orig.X' not in adata.layers.keys(): 
                    adata.layers['orig.X'] = adata.X   
                    adata.var['orig.X;;tMean'] = adata.var['X;;tMean']
                    adata.var['orig.X;;tMeanSq'] = adata.var['X;;tMeanSq']
                    self.shm_layers_csr['orig.X'] = self.shm_layers_csr['X']
                    self.shm_layers_csc['orig.X'] = self.shm_layers_csc['X']

                if adata.raw is not None:
                    X = adata.raw.X
                    mean,v = sf.mean_variance_axis(X,axis=0)
                    meansq = v-mean**2
                    adata.var[f".raw;;tMean"] = mean
                    adata.var[f".raw;;tMeanSq"] = meansq

                    del adata.raw
                    
                    if X.getformat() == "csc":
                        X1 = X
                        X2 = fmt_swapper(X)
                    elif X.getformat() == "csr":
                        X1 = fmt_swapper(X)
                        X2 = X
                    else:
                        X1 = X.tocsc()
                        X2 = X.tocsr()                        
                    adata.layers[".raw"] = X1
                    self.shm_layers_csr[".raw"] = _create_shm_from_data(X2)
                    self.shm_layers_csc[".raw"] = _create_shm_from_data(X1)

                self.data = adata

        except ValueError:
            raise DatasetAccessError(
                "File must be in the .h5ad format. Please read "
                "https://github.com/theislab/scanpy_usage/blob/master/170505_seurat/info_h5ad.md to "
                "learn more about this format. You may be able to convert your file into this format "
                "using `cellxgene prepare`, please run `cellxgene prepare --help` for more "
                "information."
            )
        except MemoryError:
            raise DatasetAccessError("Out of memory - file is too large for available memory.")
        except Exception as e:
            print(e)
            raise DatasetAccessError(
                "File not found or is inaccessible. File must be an .h5ad object. "
                "Please check your input and try again."
            )

    def _initialize_user_folders(self,userID):
        if not os.path.exists(f"{userID}/"):
            os.makedirs(f"{userID}/nnm/")
            os.makedirs(f"{userID}/emb/")
            os.makedirs(f"{userID}/params/")

            pickle.dump(self._obs_init,open(f"{userID}/obs.p",'wb'))
            for k in self._obsm_init.keys():
                k2 = "X_".join(k.split("X_")[1:])
                pickle.dump(self._obsm_init[k],open(f"{userID}/emb/{k2}.p",'wb'))
                r = self._obsp_init.get("N_"+k2,self._obsp_init.get("connectivities",None))
                p = self._uns_init.get("N_"+k2+"_params",{})
                if r is not None:
                    pickle.dump(r,open(f"{userID}/nnm/{k2}.p",'wb'))
                    pickle.dump(p,open(f"{userID}/params/{k2}.p",'wb'))
            

    def _validate_and_initialize(self):
        if anndata_version_is_pre_070():
            warnings.warn(
                "Use of anndata versions older than 0.7 will have serious issues. Please update to at "
                "least anndata 0.7 or later."
            )

        # var and obs column names must be unique
        if not self.data.obs.columns.is_unique or not self.data.var.columns.is_unique:
            raise KeyError("All annotation column names must be unique.")

        self._alias_annotation_names()
        self._validate_data_types()
        self.cell_count = self.data.shape[0]
        self.gene_count = self.data.shape[1]
        self._create_schema()

        self._obsm_init = self.data.obsm
        self._obs_init = self.data.obs
        self._uns_init = self.data.uns
        self._obsp_init = self.data.obsp

        del self.data.obs
        del self.data.obsm
        del self.data.uns
        del self.data.obsp

        self.data.obsm['X_root'] = self._obsm_init['X_root']
        self.data.obs["name_0"] = self._obs_init["name_0"]

        self._obs_init = self._obs_init.set_index("name_0")


        # heuristic
        n_values = self.data.shape[0] * self.data.shape[1]
        if (n_values > 1e8 and self.server_config.adaptor__anndata_adaptor__backed is True) or (n_values > 5e8):
            self.parameters.update({"diffexp_may_be_slow": True})


        id = (self.get_location()).encode()
        self.guest_idhash = base64.b32encode(blake2b(id, digest_size=5).digest()).decode("utf-8")
        self._initialize_user_folders(self.guest_idhash)

    def _is_valid_layout(self, arr):
        """return True if this layout data is a valid array for front-end presentation:
        * ndarray, dtype float/int/uint
        * with shape (n_obs, >= 2)
        * with all values finite or NaN (no +Inf or -Inf)
        """
        is_valid = type(arr) == np.ndarray and arr.dtype.kind in "fiu"
        is_valid = is_valid and arr.shape[0] == self.data.n_obs and arr.shape[1] >= 2
        is_valid = is_valid and not np.any(np.isinf(arr)) and not np.all(np.isnan(arr))
        return is_valid

    def _validate_data_types(self):
        # The backed API does not support interrogation of the underlying sparsity or sparse matrix type
        # Fake it by asking for a small subarray and testing it.   NOTE: if the user has ignored our
        # anndata <= 0.7 warning, opted for the --backed option, and specified a large, sparse dataset,
        # this "small" indexing request will load the entire X array. This is due to a bug in anndata<=0.7
        # which will load the entire X matrix to fullfill any slicing request if X is sparse.  See
        # user warning in _load_data().
        X0 = self.data.X[0, 0:1]
        if sparse.isspmatrix(X0) and not sparse.isspmatrix_csc(X0):
            warnings.warn(
                "Anndata data matrix is sparse, but not a CSC (columnar) matrix.  "
                "Performance may be improved by using CSC."
            )
        if self.data.X.dtype != "float32":
            warnings.warn(
                f"Anndata data matrix is in {self.data.X.dtype} format not float32. " f"Precision may be truncated."
            )
        for ax in Axis:
            curr_axis = getattr(self.data, str(ax))
            for ann in curr_axis:
                datatype = curr_axis[ann].dtype
                downcast_map = {
                    "int64": "int32",
                    "uint32": "int32",
                    "uint64": "int32",
                    "float64": "float32",
                }
                if datatype in downcast_map:
                    warnings.warn(
                        f"Anndata annotation {ax}:{ann} is in unsupported format: {datatype}. "
                        f"Data will be downcast to {downcast_map[datatype]}."
                    )
                if isinstance(datatype, CategoricalDtype):
                    category_num = len(curr_axis[ann].dtype.categories)
                    if category_num > 500 and category_num > self.dataset_config.presentation__max_categories:
                        warnings.warn(
                            f"{str(ax).title()} annotation '{ann}' has {category_num} categories, this may be "
                            f"cumbersome or slow to display. We recommend setting the "
                            f"--max-category-items option to 500, this will hide categorical "
                            f"annotations with more than 500 categories in the UI"
                        )

    def annotation_to_fbs_matrix(self, axis, fields=None, labels=None):
        if axis == Axis.OBS:
            if labels is not None and not labels.empty:
                labels["name_0"] = self.data.obs["name_0"]
                df = labels
            else:
                df = self.data.obs
        else:
            df = self.data.var

        if fields is not None and len(fields) > 0:
            df = df[fields]
        return encode_matrix_fbs(df, col_idx=df.columns)

    def get_embedding_names(self):
        """
        Return pre-computed embeddings.

        function:
            a) generate list of default layouts
            b) validate layouts are legal.  remove/warn on any that are not
            c) cap total list of layouts at global const MAX_LAYOUTS
        """
        # load default layouts from the data.
        layouts = self.dataset_config.embeddings__names

        if layouts is None or len(layouts) == 0:
            layouts = [key[2:] for key in self.data.obsm_keys() if type(key) == str and key.startswith("X_")]

        # remove invalid layouts
        valid_layouts = []
        obsm_keys = self.data.obsm_keys()
        for layout in layouts:
            layout_name = f"X_{layout}"
            if layout_name not in obsm_keys:
                warnings.warn(f"Ignoring unknown layout name: {layout}.")
            elif not self._is_valid_layout(self.data.obsm[layout_name]):
                warnings.warn(f"Ignoring layout due to malformed shape or data type: {layout}")
            else:
                valid_layouts.append(layout)
        # cap layouts to MAX_LAYOUTS
        return valid_layouts[0:MAX_LAYOUTS]

    def get_embedding_array(self, ename, dims=2):
        annotations = self.dataset_config.user_annotations        
        userID = f"{annotations._get_userdata_idhash(self)}"
        try:
            full_embedding = pickle.load(open(f"{userID}/emb/{ename}.p",'rb'))
        except:
            full_embedding = self._obsm_init[f"X_{ename}"]
        return full_embedding[:, 0:dims]

    def get_colors(self):
        return convert_anndata_category_colors_to_cxg_category_colors(self.data)

    def get_X_array(self, col_idx, layer="X", logscale=False):
        def bisym_log_transform(x):
             return np.sign(x)*np.log(1+np.abs(x))

        #if row_idx is None:
        #    row_idx = np.arange(self.data.shape[0])
        if layer == "X":
            XI = self.data.X
        else:
            XI = self.data.layers[layer]

        if col_idx is None:
            col_idx = np.arange(self.data.shape[1])        
        
        if col_idx.size == 1:
            i1 = col_idx[0]
                            
            d = XI.data[XI.indptr[i1] : XI.indptr[i1 + 1]]
            i = XI.indices[XI.indptr[i1] : XI.indptr[i1 + 1]]
            x = np.zeros(XI.shape[0])
            x[i] = d
            x=x[:,None]
            if logscale:
                x = bisym_log_transform(x)
            #x=x[row_idx][:,None]                
        else:
            x = XI[:,col_idx]
            if logscale:
                if sparse.issparse(x):
                    x.data[:] = bisym_log_transform(x.data)
                else:
                    x = bisym_log_transform(x)
        return x

    def get_shape(self):
        return self.data.shape

    def query_var_array(self, term_name):
        return getattr(self.data.var, term_name)

    def query_obs_array(self, term_name):
        return getattr(self.data.obs, term_name)

    def get_obs_index(self):
        name = self.server_config.single_dataset__obs_names
        if name is None:
            return self.original_obs_index
        else:
            return self.data.obs[name]

    def get_obs_columns(self):
        return self.data.obs.columns

    def get_obs_keys(self):
        # return list of keys
        return self.data.obs.keys().to_list()

    def get_var_keys(self):
        # return list of keys
        return self.data.var.keys().to_list()

