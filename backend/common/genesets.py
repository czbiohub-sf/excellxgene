"""
Utility code for gene sets handling
"""

import re
import csv
import hashlib
import numpy as np

from .errors import AnnotationsError


GENESETS_TIDYCSV_HEADER = [
    "gene_set_description",    
    "gene_set_name",
    "differential_expression"
]


def read_gene_sets_tidycsv(gs_locator, context=None):
    """
    Read & parse the Tidy CSV format, applying validation checks for mandatory
    values, and de-duping rules.

    Format is a four-column CSV, with a mandatory header row, and optional "#" prefixed
    comments.  Format:

        gene_set_name, gene_set_description, gene_symbol, gene_description

    gene_set_name must be non-null; others are optional.

    Returns: a dictionary of the shape (values in angle-brackets vary):

        {
            <string, a gene set name>: {
                "geneset_name": <string, a gene set name>,
                "geneset_description": <a string or None>,
                "genes": [
                    {
                        "gene_symbol": <string, a gene symbol or name>,
                        "gene_description": <a string or None>
                    },
                    ...
                ]
            },
            ...
        }
    """

    class myDialect(csv.excel):
        skipinitialspace = False

    gene_sets = {}
    with gs_locator.local_handle() as fname:
        header_read = False
        with open(fname, newline="") as f:
            reader = csv.reader(f, dialect=myDialect())
            for row in reader:
                if len(row) <= 3 or not header_read:
                    header_read = True
                    continue

                geneset_description, geneset_name, diffExp = row[:3]
                x = "//;;//" if (diffExp=="TRUE" or diffExp == "True" or diffExp == "true") else ""
                geneset_description+=x
                gene_symbols = row[3:]
                try:
                    gene_symbols = gene_symbols[:gene_symbols.index("")]
                except:
                    pass
                
                if geneset_description in gene_sets:
                    gs = gene_sets[geneset_description]
                else:
                    gs = gene_sets[geneset_description] = {}
                
                if geneset_name in gs:
                    gene_symbols = list(set(gene_symbols).union(gs[geneset_name]))

                gs[geneset_name] = gene_symbols


    return gene_sets


def write_gene_sets_tidycsv(f, genesets):
    """
    Convert the internal gene sets format (returned by read_gene_set_tidycsv) into
    the simple Tidy CSV.
    """
    writer = csv.writer(f, dialect="excel")
    writer.writerow(GENESETS_TIDYCSV_HEADER)
    for k1 in genesets.keys():
        for k2 in genesets[k1].keys():
            genes = genesets[k1].get(k2,None)
            k3 ='//;;//' in k1
            knew = k1.split('//;;//')[0]
            if not genes:
                writer.writerow([knew, k2, k3])
            else:
                writer.writerow([knew, k2, k3]+genes)


def summarizeQueryHash(raw_query):
    """ generate a cache key (hash) from the raw query string """
    return hashlib.sha1(raw_query).hexdigest()


def validate_gene_sets(genesets, var_names, context=None):
    """
    Check validity of gene sets, return if correct, else raise error.
    May also modify the gene set for conditions that should be resolved,
    but which do not warrant a hard error.

    Argument gene sets may be either the REST OTA format (list of dicts) or the internal
    format (dict of dicts, keyed by the gene set name).

    Will return a modified gene sets (eg, remove warnings) of the same type as the
    provided argument. Ie, dict->dict, list->list

    Rules:

    0. All gene set names must be unique. [error]
    1. Gene set names must conform to the following: [error]
        * Names must be comprised of 1 or more ASCII characters 32-126
        * No leading or trailing spaces (ASCII 32)
        * No multi-space (ASCII 32) runs
    2. Gene symbols must be part of the current var_index. [warning]
       If gene symbol is not in the var_index, generate a warning and remove the symbol
       from the gene sets.
    3. Gene symbols must not be duplicated in a gene set.  [warning]
       Duplications will be silently de-duped.

    Items marked [error] will generate a hard error, causing the validation to fail.

    Items marked [warning] will generate a warning, and will be resolved without failing
    the validation (typically by removing the offending item from the gene sets).
    """

    messagefn = context["messagefn"] if context else (lambda x: None)

    # accept genesets args as either the internal (dict) or REST (list) format,
    # as they are identical except for the dict being keyed by geneset_name.
    if not isinstance(genesets, dict):
        raise ValueError("Gene sets must be a dict.")

    for k1 in genesets.keys():
        for name in genesets[k1].keys():
            if type(name) != str or len(name) == 0:
                raise KeyError("Gene set names must be non-null string.")            
         

    for k1 in genesets.keys():
        for k2 in genesets[k1].keys():
            genes = genesets[k1][k2]
            if not isinstance(genes, list):
                raise ValueError("Gene set genes field must be a list")
            gene_symbol_already_seen = set()
            new_genes = []
            for gene_symbol in genes:
                if not isinstance(gene_symbol, str) or len(gene_symbol) == 0:
                    raise ValueError("Gene symbol must be non-null string.")
                if gene_symbol in gene_symbol_already_seen:
                    # duplicate check
                    messagefn(
                        f"Warning: a duplicate of gene {gene_symbol} was found in gene set {k1}:{k2}, "
                        "and will be ignored."
                    )
                    continue

                if gene_symbol not in var_names:
                    messagefn(
                        f"Warning: {gene_symbol}, used in gene set {k1}:{k2}, "
                        "was not found in the dataset and will be ignored."
                    )
                    continue

                gene_symbol_already_seen.add(gene_symbol)
                new_genes.append(gene_symbol)

            genesets[k1][k2] = new_genes

    return genesets
