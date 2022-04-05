<img src="./cellxgene-logo.png" width="300">

# Exploratory CellxGene (ExCellxGene)

Video vignettes to come!

## V2.6.3
In the latest version, the internal file system used by excellxgene has been restructured. As a result, launching excellxgene on a dataset you have previously worked with will create a new folder with none of your previous work. You will need to migrate your work to the new version of excellxgene. The easiest way to do this is with the following:

1. Create a new conda environment (same instructions as in the installation section).
2. Pip install `excellxgene==2.6.3`
3. Launch the new version of excellxgene.
4. Upload the metadata/genesets/etc downloaded from the old version of excellxgene to the new version.

### Installation

1. Install miniconda if conda not available already:

```
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh -O ~/miniconda.sh
bash ~/miniconda.sh -b -p $HOME/miniconda
```

2. Create and activate a new environment:

```
conda create -n cxg python=3.8
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
git clone https://github.com/czbiohub/excellxgene
cd excellxgene
```
Datasets are stored in `example-dataset`

5. Launch excellxgene with:
```
excellxgene launch example-dataset
```


This should launch an excellxgene session with all the datasets in example-datasets/ loaded in.

If you're running excellxgene remotely, please launch with:
```
excellxgene launch example-datasets --host 0.0.0.0
```

Ping me on the Biohub slack (@Alec) if you have any questions!
