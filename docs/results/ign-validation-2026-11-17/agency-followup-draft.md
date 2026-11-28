# Draft follow-up to IGN — not sent

## Español

Gracias por su respuesta del 17 de noviembre. Para interpretar correctamente los registros históricos necesitamos aclarar estos puntos concretos:

1. **Referencia de tiempo de los ficheros.** ¿Las fechas y horas de `observados/ficheros_anuales`, los ficheros diarios de `observados` y `procesados/{integros,horarios}` representan UTC/TU durante toda su historia? Si hubo hora civil, hora local, horario de verano, horas de comienzo/final de intervalo o cambios de reloj, ¿podrían indicar la convención y sus fechas por estación y sensor? El `Leeme.txt` menciona una «Corrección de desfase temporal» en los datos procesados; necesitamos saber qué convenciones y errores conserva cada serie bruta.

2. **ACOR1, sensor 0302, 1950.** En `ACOR1/observados/ficheros_anuales/200031_0302_1950.txt` se leen, entre otras, las líneas `01/01/1950 01:00:00 2980 mm` y `01/01/1950 02:00:00 3150 mm`. La serie publicada se ajusta mejor a una predicción armónica independiente de A Coruña con desfases de aproximadamente 90–140 minutos según el mes, no con un único desfase constante. ¿Existe una tabla de correcciones del reloj o información sobre la digitalización de estos mareogramas? El fichero también contiene una observación fechada `01/01/1951 00:00:00`; ¿es una convención de cierre del día/año que deba conservarse como tal?

3. **ACOR1, sensor 0601, 1998.** `ACOR1/observados/ficheros_anuales/200031_0601_1998.txt` comienza con datos numéricos el `20/05/1998 08:10:00`. Al compararlo con la misma referencia independiente encontramos aproximadamente +60 minutos en mayo, +70 en junio, +130 en julio y 0 en septiembre–diciembre. ¿Se conocen ajustes o averías del reloj en ese periodo? Estas cifras son resultados de comprobación, no correcciones que hayamos aplicado.

3a. **Otros desfases en comparaciones independientes del mismo puerto.** `TN013/observados/ficheros_anuales/370031_1301_2013.txt` presenta un óptimo de aproximadamente +60 minutos frente a REDMAR Tenerife (r≈0,996; desfase K1≈+55 minutos). Los brutos FUER1/0805 y 1607 de 2015 presentan aproximadamente −30 y −40 minutos frente a REDMAR Fuerteventura. ¿Existe un historial de correcciones del reloj por sensor que cubra también estos casos? Estos son resultados de comprobación, no correcciones aplicadas.

4. **Signo y cero de los registros gráficos de ACOR1.** El fichero `200031_1101_1997.txt` comienza con `01/01/1997 00:00:00 3714 "mm"`, `01/01/1997 01:00:00 3930 "mm"` y `01/01/1997 02:00:00 3935 "mm"`. Sus valores publicados tienen correlación negativa (~−0,986) con una predicción independiente, mientras que el mismo sensor en 1978 tiene correlación positiva. ¿Representan alturas o distancias agua–referencia en cada periodo? ¿Hubo cambios de signo, cero instrumental, sensor real o identificación del sensor? Necesitamos la relación de calibración y sus fechas, sin suponer que todo registro gráfico tiene el mismo signo.

5. **Escala del sensor ALAC1/0501.** En `ALAC1/observados/ficheros_anuales/220051_0501_1991.txt` aparecen `01/01/1991 01:00:00 250 "mm"` y `01/01/1991 02:00:00 242 "mm"`. ¿La etiqueta «mm» corresponde directamente al desplazamiento real del nivel del mar en todos los años de 0501? ¿Existe algún factor de escala del registrador, relación de reducción o cambio de calibración que deba aplicarse? Solicitamos las fechas y los parámetros, además del signo y del cero de referencia.

6. **Calibraciones y actualización de los brutos.** ¿Disponen de metadatos históricos por instrumento que documenten unidad, escala, signo, cero y señal de referencia? ¿Los ficheros de `observados` pueden corregirse o reemplazarse en el servidor después de publicarse? En caso afirmativo, ¿hay fecha de revisión o registro de cambios para detectar esas correcciones? Si los ficheros diarios y anuales discrepan, ¿cuál es autoritativo, incluso cuando uno marca explícitamente un dato como ausente?

No hemos aplicado correcciones deducidas únicamente de estas comparaciones. Nuestro objetivo es evitar publicar como UTC o como alturas calibradas datos cuya interpretación todavía no está confirmada.

7. **Ficheros que necesitan aclaración o corrección.** En `ALBO1/procesados/integros/220048_2017_BM.txt` figura `19/01/2017 07:00:00 --40`; hay diez valores con doble signo menos en los ficheros de 2017–2019. ¿Cuál es su interpretación correcta? `MURC2/procesados/integros/220047_2024_JM.txt` contiene 1.440 filas `31/11/2024` con valor `---`; ¿a qué fecha corresponden? En el íntegro TN031 de 2019 aparece `07/05/2109 00:17:00 -9999`; ¿pueden corregir la fecha? No hemos convertido automáticamente estas fechas en otras fechas plausibles.

8. **Identidad y cabecera.** El íntegro ALME2 de 2022 (`220042_2022_JM.txt`) carece de cabecera y empieza `01/01/2022 00:00:00 -16531`. ¿Podrían confirmar estación, unidad, señal y referencia aplicables y publicar la cabecera? El anual `ALAC1/observados/ficheros_anuales/220051_0702_2006.txt` es idéntico byte por byte al de 2005 y sus datos pertenecen a 2005: ¿existe el fichero correcto de 2006? El anual ACOR1 de 2021 llamado `220031_1606_2021.txt` tiene un prefijo distinto del código ACOR1 `200031`; solicitamos confirmar su identidad.

9. **Canales no descritos y ficheros en carpetas de otra estación.** El catálogo diario completo contiene ACOR1/0801 (2005–2007), ALAC1/1703 (2011), ALAC2/0501 (1976–1979) y ALAC2/0208 (1990), que no están identificados en las fichas actuales. ¿Qué instrumentos, unidades, signos, escalas y referencias representan? Como ejemplos de ubicación dudosa, `ALAC1/observados/2015/220052_1604_20150426.txt` nombra ALAC2 y `ALAC1/observados/2016/370031_0801_20161023.txt` nombra TN013. La relación completa del catálogo contiene otros ejemplos y exportaciones de aspecto anual dentro de carpetas diarias: necesitamos confirmar estación propietaria y ubicación correcta antes de asignarlos.

10. **Valores -9999 en los horarios de Coruña.** En los 24 ficheros horarios ACOR1 de 2000–2023 hay 840 valores numéricos `-9999`, frente a valores ordinarios entre −7046 y −1528 mm. En 798 de esas horas los íntegros solo contienen valores ausentes; otras horas coinciden con datos parciales o una señal constante. ¿Confirma `-9999` un agregado horario ausente o rechazado, y qué criterio de calidad/cobertura se aplica? No lo hemos extrapolado a TN013, donde −9,999 m puede ser una altura real.

## English

Thank you for your 17 November reply. We need the following details to interpret the historical observations correctly:

1. **File time convention.** Are timestamps in annual/daily `observados` and `procesados/{integros,horarios}` UTC/UT throughout their complete histories? If civil/local time, daylight saving, interval-start/end labels or clock changes were used, please provide the convention and effective dates by station and instrument. `Leeme.txt` explicitly mentions temporal-phase corrections in processed data, so reviewed records cannot establish the raw records’ clock conventions.

2. **ACOR1/0302, 1950.** `200031_0302_1950.txt` includes `01/01/1950 01:00:00 2980 mm` and `01/01/1950 02:00:00 3150 mm`. Against an independent A Coruña harmonic prediction, monthly best lags are approximately 90–140 minutes rather than one constant offset. Is a chart-clock correction or digitization history available? The file also contains `01/01/1951 00:00:00`: is this an intentional end-of-day/year convention?

3. **ACOR1/0601, 1998.** Numerical data begin on `20/05/1998 08:10:00`. Comparison with the same independent reference finds approximately +60 minutes in May, +70 in June, +130 in July and zero in September–December. Were clock adjustments or faults recorded? These are diagnostic results; we have applied no inferred corrections.

3a. **Additional same-port independent clock checks.** `TN013/observados/ficheros_anuales/370031_1301_2013.txt` fits REDMAR Tenerife best at approximately +60 minutes (r≈0.996; K1≈+55 minutes). FUER1/0805 and 1607 in 2015 fit REDMAR Fuerteventura best at approximately −30 and −40 minutes. Is a dated instrument-clock correction history available for these cases? We have applied no inferred corrections.

4. **ACOR1 chart signs and zero.** `200031_1101_1997.txt` starts with 3714, 3930 and 3935 `"mm"` at 00:00, 01:00 and 02:00 on 1 January 1997. The published values correlate negatively (~−0.986) with an independent prediction, while sensor 1101 in 1978 correlates positively. Does each period contain heights or water-to-reference distances? Were there changes in sign, instrumental zero, actual instrument or sensor identification? Please provide the dated calibration relationship.

5. **ALAC1/0501 scale.** `220051_0501_1991.txt` labels values 250 and 242 at 01:00 and 02:00 on 1 January 1991 as `"mm"`. Does this label directly represent real sea-level displacement in every 0501 year, or is an instrument reduction/scale factor or calibration change required? Please provide dated parameters, sign and reference zero.

6. **Historical calibration and raw-file revisions.** Are dated instrument metadata available for units, scale, sign, zero and reference marks? Can published `observados` files be corrected/replaced in place, and is there a revision timestamp or change log? When daily and annual exports disagree, which is authoritative, including when one explicitly marks a reading missing?

We have not applied corrections inferred only from these comparisons. We want to avoid publishing unconfirmed clock or calibration interpretations as established facts.

7. **Malformed values and dates.** `ALBO1/procesados/integros/220048_2017_BM.txt` contains `19/01/2017 07:00:00 --40`; there are ten double-minus values across 2017–2019. What values were intended? `MURC2/procesados/integros/220047_2024_JM.txt` contains 1,440 `31/11/2024` rows with `---`; what date was intended? TN031’s 2019 íntegro includes `07/05/2109 00:17:00 -9999`. Please correct the source dates; we have not rolled them into plausible dates.

8. **File identity and missing header.** ALME2’s 2022 íntegro `220042_2022_JM.txt` is headerless and starts `01/01/2022 00:00:00 -16531`. Please confirm its station, unit, mark and reference, and provide the header. ALAC1 annual `220051_0702_2006.txt` is byte-identical to 2005 and contains 2005 dates: is the correct 2006 export available? ACOR1 annual2021 is named `220031_1606_2021.txt`, whereas ACOR1’s station prefix is200031: please confirm its identity.

9. **Undocumented channels and misplaced files.** The complete daily catalog contains ACOR1/0801 (2005–2007), ALAC1/1703 (2011), ALAC2/0501 (1976–1979) and ALAC2/0208 (1990), absent from current sheets. Please identify their instruments, units, signs, scales and references. Examples of files under another station’s directory are `ALAC1/observados/2015/220052_1604_20150426.txt` (filename identifies ALAC2) and `ALAC1/observados/2016/370031_0801_20161023.txt` (identifies TN013). The complete census records additional misplaced filenames and annual-looking files inside daily directories; please confirm ownership and correct locations.

The [validation report](../ign-validation-2026-11-17.md) records input URLs, hashes, scope and source anomalies. Exact agency URLs are under `https://datos-geodesia.ign.es/Red_de_Mareografos/`.

10. **Coruña hourly -9999 values.** The 24 ACOR1 hourly files for 2000–2023 contain 840 numeric `-9999` aggregates; ordinary values span −7046 to −1528 mm. For 798 hours, all corresponding full-resolution samples are missing; the rest overlap partial or held data. Does `-9999` mean a missing/rejected hourly aggregate, and what quality/coverage criterion is used? We have not extrapolated this interpretation to TN013, where −9.999 m can be a real height.
