# Karavali-Transit mini-project report

This folder contains the report based on the LaTeX template supplied by the students:

- `main.tex` - complete report source, with TikZ diagrams included inline.
- `references.bib` - sources cited by the report.
- `main.pdf` - compiled report (when generated in this workspace).

## Compile

Install a LaTeX engine with bibliography support, then from this directory run:

```powershell
tectonic main.tex
```

Alternatively, with a TeX Live/MiKTeX installation:

```powershell
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
```

The report uses the `newtx` Times-compatible text/math fonts and TikZ for vector diagrams. Tectonic may download missing TeX packages when network access is available; the generated `main.pdf` is included when the current environment can compile it.

## College logos and final review

The supplied template refers to `vtu logo.jpeg` and `Sayhadri.jpg`, but neither image was present in the repository. The source therefore compiles with labeled placeholders. Before submission, place the authorized college logo files in this folder using those exact filenames. Confirm the guide's designation, coordinator details, academic-year wording, screenshots, and any department-required certification language with the college. Four screenshot placeholders in Chapter 8 should be replaced with captures from the running application.

The source describes implemented behavior based on this repository. The testing chapter reports the exact selected test command and observed outcome; it does not claim the broader integration suites or field/device tests were run.
