<img src="./docs/cellxgene-logo.png" width="300">

# Exploratory CellxGene (ExCellxGene)
This fork implements some of the key features that have been highly requested by the data science team at CZBiohub.

Features include:
- Hotkeys (SHIFT+? to see a tooltip describing all available  hotkeys)
- End-to-end interactive analysis and reembedding, with new embeddings hierarchically organized.
- LIDAR graph interaction mode (the airplane) - Show an interactive tooltip describing the cells underneath your cursor. Very helpful for the color impaired or for large datasets with hundreds of labels.
- Sankey plots
- Leiden clustering
- Label fusion and deletion
- Interactive selection of data layer for expression visualization
- Many other quality-of-life improvements.

## Patch notes (v1.2.5)
- When displaying continuous metadata, cells with value zero are drawn as if they are unselected to send them to the background.
- Category and geneset menus now have a new menu item to include/exclude zeros from the histograms. This is useful  when the distributions are super zero-inflated.

## Patch notes (v1.2.3)
- Gene sets are now grouped based on their descriptions under collapsible headers.
- Gene sets are now more compact, displaying 10 genes at a time with buttons to flip through pages.
- Differential expression now calculates the top 100 genes.
- A new button in the menubar allows you to calculate marker genes for all labels in a selected category.
- Embeddings are now indented according to their hierarchical organization, and nested embeddings are collapsible.
- Categorical labels are now sortable based on the currently displayed continuous medatada.
- All preprocessing and reembedding parameters now have a tooltip.
- Added a button to display hotkey menu to the menubar.
- Various bugfixes.

### Installation

1. Install miniconda if conda not available already:

```
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh -O ~/miniconda.sh
bash ~/miniconda.sh -b -p $HOME/miniconda
```

2. Create and activate a new environment:

```
conda create -n cxg python=3.7
conda activate cxg
```

3. Install excellxgene with pip:
```
pip install excellxgene
```

If your operating system is CentOS, then you may run into issues installing dependencies that require up-to-date `gcc` or `g++` compilers. Please install with the following and try reinstalling `excellxgene` with pip:
```
conda install -c conda-forge gcc cxx-compiler
```

4. Download the git repository to get the example datasets (assumes git is available, if not install it with conda install -c anaconda git)
```
git clone https://github.com/czbiohub/cellxgene
cd cellxgene
```
Datasets are stored in `example-dataset`

5. Launch cellxgene with:
```
cellxgene launch example-dataset
```


This should launch a cellxgene session with all the datasets in example-datasets/ loaded in.

If you're running excellxgene remotely, please launch with:
```
cellxgene launch example-datasets --host 0.0.0.0
```

Ping me on the Biohub slack (@Alec) if you have any questions!
