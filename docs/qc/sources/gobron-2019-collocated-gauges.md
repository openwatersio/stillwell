# Bias and precision from several collocated tide gauges (Gobron et al. 2019)

## Citation

Gobron, K., de Viron, O., Wöppelmann, G., Poirier, É., Ballu, V., and Van Camp, M., 2019, Assessment of tide gauge biases and precision by the combination of multiple collocated time series, Journal of Atmospheric and Oceanic Technology, 36(10), 1983 to 1996.

- DOI: https://doi.org/10.1175/JTECH-D-18-0235.1
- Copy read: http://www.vliz.be/imisdocs/publications/344254.pdf (publisher version)

## License and local copy

"© 2019 American Meteorological Society," reuse under the AMS copyright policy. Free to read but not openly licensed. No PDF; link only.

## What it is

A method paper on comparing sensors at the same site rather than neighbors kilometers apart. It sets out the error model behind difference-based comparisons and the Van de Casteele diagram, and shows how a third series lets each instrument's own error be separated. The field test was six gauges recording together for 11 hours on Aix Island, France, in 2016.

## Error model (section 2a, pp. 1985 to 1986)

Each series is modeled as yi(t) = h(t − τi) + bi·yi(t) + ai + ei(t), with three error types "the three most common types of range measurement biases": a height reference error (ai, a constant offset), a scale error (bi, a bias proportional to the tidal level), and a clock synchronization error (τi, a time delay). Clock delay is nonlinear in the model, so it is removed first, "for example, by computing the delay that maximizes the cross correlation between a tested signal and a reference signal. Obtaining τi by cross correlation avoids any assumptions on the periodicity of the measured signal." For longer series the model may need time-dependent biases "such as trends and jumps."

## Difference method and the Van de Casteele diagram (section 2b, pp. 1986 to 1987)

The difference Δyi(t) = yi(t) − yref(t) is plotted against yi(t). Its "most attractive feature ... is a fast, visual, detection of possible biases with only one tidal cycle." Fitting a line to it gives the offset (intercept) and scale error (slope). Fig. 4 shows the diagram patterns for the common error types, following IOC (1985), including a clock error case. (That a clock error draws an open loop or ellipse rather than a line comes from the figure and from Martín Míguez et al. 2008, which was not read; not verified from the text.) The difference method only measures the combined noise of both gauges, "just an upper bound to the tested gauge variance"; separating them needs "a third time series."

## Combination method (section 2c onward)

With three or more collocated series, least squares variance component estimation gives each gauge's bias parameters and its own precision. Applied to the experiment, the best gauge (an electrical contact probe) reached 3 mm uncertainty, and the combination gave more precise bias estimates than buddy checking against a single reference.

## Errors found

Constant datum offsets, scale errors, and clock offsets between collocated sensors, on time scales of hours.

## Not covered

No guidance for neighbors at a distance, long records, or thresholds for flagging.
