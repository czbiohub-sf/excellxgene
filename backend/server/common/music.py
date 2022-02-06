import numpy as np
import pandas as pd

#TODO: for now, considering margin 2 = sum across rows
def relative_ab(X,by_col=True):
    if np.sum(X<0)>0:
        raise ValueError("Negative entry appears!")
    if not by_col:
        RX = X / X.sum(1)[:,None]
    else:
        RX = X / X.sum(0)[None,:]
    return RX

def my_sqrt(x):
    return np.sign(x)*np.sqrt(np.abs(x))
    
def log(x):
    return np.log(x,where=0<x)

def fpkmToTpm(fpkm):
    return np.exp(log(fpkm) - log(fpkm.sum(0)[None,:]) + np.log(1e6))

def my_log(x,nu):
    return np.sign(x)*(np.log(np.abs(x)+nu)-np.log(nu))

def my_rowMeans(x,na_rm = False):
    return x(pd.DataFrame(x).mean(1,skipna=na_rm).values)

def get_upper_tri(x):
    return np.triu(x)

def q(x):
    return np.array(list(x))
# bulk_eset is pandas dataframe
def music_prop(bulk_eset, sc_eset, clusters, samples,
                markers = None, select_ct = None, cell_size = None,
                ct_cov = False, verbose = True,iter_max = 1000,
                nu = 0.0001, eps = 0.01, centered = False,
                normalize = False):
    
    bulk_gene = q(bulk_eset.index[bulk_eset.mean(1)!=0])
    bulk_eset = bulk_eset.T[bulk_gene].T
    if markers is None:
        sc_markers = bulk_gene
    else:
        sc_markers = list(set(bulk_gene).intersection(markers))

    sc_basis = music_basis(sc_eset, non_zero = True, markers = sc_markers,
                           clusters = clusters, samples = samples,
                           select_ct = select_ct, cell_size = cell_size,
                           ct_cov = ct_cov, verbose = verbose)
