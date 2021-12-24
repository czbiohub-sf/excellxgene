import numpy as np
from scipy import sparse, stats
import sklearn.utils.sparsefuncs as sf


def diffexp_ttest(meanA,vA,nA,meanB,vB,nB, top_n=8, diffexp_lfc_cutoff=0.01):
    return diffexp_ttest_from_mean_var(meanA, vA, nA, meanB, vB, nB, 1000, diffexp_lfc_cutoff)


def diffexp_ttest_from_mean_var(meanA, varA, nA, meanB, varB, nB, top_n, diffexp_lfc_cutoff):
    n_var = meanA.shape[0]
    top_n = min(n_var,top_n)

    # variance / N
    vnA = varA / min(nA, nB)  # overestimate variance, would normally be nA
    vnB = varB / min(nA, nB)  # overestimate variance, would normally be nB
    sum_vn = vnA + vnB

    # degrees of freedom for Welch's t-test
    with np.errstate(divide="ignore", invalid="ignore"):
        dof = sum_vn ** 2 / (vnA ** 2 / (nA - 1) + vnB ** 2 / (nB - 1))
    dof[np.isnan(dof)] = 1

    # Welch's t-test score calculation
    with np.errstate(divide="ignore", invalid="ignore"):
        tscores = (meanA - meanB) / np.sqrt(sum_vn)
    tscores[np.isnan(tscores)] = 0

    # p-value
    pvals = stats.t.sf(np.abs(tscores), dof) * 2
    pvals_adj = pvals * n_var
    pvals_adj[pvals_adj > 1] = 1  # cap adjusted p-value at 1

    # logfoldchanges: log2(meanA / meanB)
    logfoldchanges = np.log2(np.abs((meanA + 1e-9) / (meanB + 1e-9)))

    stats_to_sort = tscores
    # find all with lfc > cutoff
    lfc_above_cutoff_idx = np.nonzero(np.abs(logfoldchanges) > diffexp_lfc_cutoff)[0]

    # derive sort order
    sort_order = np.argsort(stats_to_sort)
    sort_order = np.concatenate((sort_order[-top_n:][::-1],sort_order[:top_n][::-1]))
    if lfc_above_cutoff_idx.shape[0] > 0:
        sort_order = sort_order[np.in1d(sort_order,lfc_above_cutoff_idx)]
    # top n slice based upon sort order
    logfoldchanges_top_n = logfoldchanges[sort_order]
    pvals_top_n = pvals[sort_order]
    pvals_adj_top_n = pvals_adj[sort_order]

    # varIndex, logfoldchange, pval, pval_adj
    result = {"positive": [[sort_order[i], logfoldchanges_top_n[i], pvals_top_n[i], pvals_adj_top_n[i]] for i in
                           range(top_n)],
              "negative": [[sort_order[i], logfoldchanges_top_n[i], pvals_top_n[i], pvals_adj_top_n[i]] for i in
                           range(-1, -1 - top_n, -1)], }

    return result

def mean_var_n(X):
    """
    Two-pass variance calculation.  Numerically (more) stable
    than naive methods (and same method used by numpy.var())
    https://en.wikipedia.org/wiki/Algorithms_for_calculating_variance#Two-pass
    """
    n = X.shape[0]
    if sparse.issparse(X):
        mean,v = sf.mean_variance_axis(X,axis=0)
    else:
        mean,v = X.mean(0),X.var(0)
    meansq = v - mean**2
    return mean, meansq, v, n
