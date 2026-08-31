/**
 * Countries offered as a moderator's region, grouped as they are shown.
 *
 * Each carries an IANA timezone because the Schedule and Finance pages convert
 * shift times into the moderator's local clock. Where a country spans several
 * zones the commercial centre is used — this answers "roughly what time is it
 * for them", not a precise per-person clock.
 */
const GROUPS = [
  ['Asia', [
    ['Malaysia', 'Asia/Kuala_Lumpur'], ['Singapore', 'Asia/Singapore'], ['Indonesia', 'Asia/Jakarta'],
    ['Philippines', 'Asia/Manila'], ['Thailand', 'Asia/Bangkok'], ['Vietnam', 'Asia/Ho_Chi_Minh'],
    ['Myanmar', 'Asia/Yangon'], ['Cambodia', 'Asia/Phnom_Penh'], ['Laos', 'Asia/Vientiane'],
    ['Brunei', 'Asia/Brunei'], ['Timor-Leste', 'Asia/Dili'], ['China', 'Asia/Shanghai'],
    ['Japan', 'Asia/Tokyo'], ['South Korea', 'Asia/Seoul'], ['Taiwan', 'Asia/Taipei'],
    ['Hong Kong', 'Asia/Hong_Kong'], ['Macau', 'Asia/Macau'], ['Mongolia', 'Asia/Ulaanbaatar'],
    ['India', 'Asia/Kolkata'], ['Pakistan', 'Asia/Karachi'], ['Bangladesh', 'Asia/Dhaka'],
    ['Sri Lanka', 'Asia/Colombo'], ['Nepal', 'Asia/Kathmandu'], ['Bhutan', 'Asia/Thimphu'],
    ['Maldives', 'Indian/Maldives'], ['Afghanistan', 'Asia/Kabul'], ['Iran', 'Asia/Tehran'],
    ['Iraq', 'Asia/Baghdad'], ['Saudi Arabia', 'Asia/Riyadh'], ['UAE', 'Asia/Dubai'],
    ['Qatar', 'Asia/Qatar'], ['Kuwait', 'Asia/Kuwait'], ['Bahrain', 'Asia/Bahrain'],
    ['Oman', 'Asia/Muscat'], ['Yemen', 'Asia/Aden'], ['Jordan', 'Asia/Amman'],
    ['Lebanon', 'Asia/Beirut'], ['Syria', 'Asia/Damascus'], ['Israel', 'Asia/Jerusalem'],
    ['Palestine', 'Asia/Hebron'], ['Turkey', 'Europe/Istanbul'], ['Armenia', 'Asia/Yerevan'],
    ['Azerbaijan', 'Asia/Baku'], ['Georgia', 'Asia/Tbilisi'], ['Kazakhstan', 'Asia/Almaty'],
    ['Uzbekistan', 'Asia/Tashkent'], ['Turkmenistan', 'Asia/Ashgabat'], ['Tajikistan', 'Asia/Dushanbe'],
    ['Kyrgyzstan', 'Asia/Bishkek'],
  ]],
  ['Europe', [
    ['UK', 'Europe/London'], ['Ireland', 'Europe/Dublin'], ['Portugal', 'Europe/Lisbon'],
    ['Spain', 'Europe/Madrid'], ['France', 'Europe/Paris'], ['Germany', 'Europe/Berlin'],
    ['Netherlands', 'Europe/Amsterdam'], ['Belgium', 'Europe/Brussels'], ['Luxembourg', 'Europe/Luxembourg'],
    ['Switzerland', 'Europe/Zurich'], ['Austria', 'Europe/Vienna'], ['Italy', 'Europe/Rome'],
    ['Vatican', 'Europe/Vatican'], ['San Marino', 'Europe/San_Marino'], ['Monaco', 'Europe/Monaco'],
    ['Andorra', 'Europe/Andorra'], ['Malta', 'Europe/Malta'], ['Greece', 'Europe/Athens'],
    ['Cyprus', 'Asia/Nicosia'], ['Denmark', 'Europe/Copenhagen'], ['Sweden', 'Europe/Stockholm'],
    ['Norway', 'Europe/Oslo'], ['Finland', 'Europe/Helsinki'], ['Iceland', 'Atlantic/Reykjavik'],
    ['Poland', 'Europe/Warsaw'], ['Czech Republic', 'Europe/Prague'], ['Slovakia', 'Europe/Bratislava'],
    ['Hungary', 'Europe/Budapest'], ['Romania', 'Europe/Bucharest'], ['Bulgaria', 'Europe/Sofia'],
    ['Croatia', 'Europe/Zagreb'], ['Slovenia', 'Europe/Ljubljana'], ['Bosnia', 'Europe/Sarajevo'],
    ['Serbia', 'Europe/Belgrade'], ['Montenegro', 'Europe/Podgorica'], ['North Macedonia', 'Europe/Skopje'],
    ['Albania', 'Europe/Tirane'], ['Kosovo', 'Europe/Belgrade'], ['Moldova', 'Europe/Chisinau'],
    ['Ukraine', 'Europe/Kyiv'], ['Belarus', 'Europe/Minsk'], ['Lithuania', 'Europe/Vilnius'],
    ['Latvia', 'Europe/Riga'], ['Estonia', 'Europe/Tallinn'], ['Russia', 'Europe/Moscow'],
    ['Liechtenstein', 'Europe/Vaduz'],
  ]],
  ['Americas', [
    ['USA', 'America/New_York'], ['Canada', 'America/Toronto'], ['Mexico', 'America/Mexico_City'],
    ['Brazil', 'America/Sao_Paulo'], ['Argentina', 'America/Argentina/Buenos_Aires'],
    ['Chile', 'America/Santiago'], ['Colombia', 'America/Bogota'], ['Venezuela', 'America/Caracas'],
    ['Peru', 'America/Lima'], ['Ecuador', 'America/Guayaquil'], ['Bolivia', 'America/La_Paz'],
    ['Paraguay', 'America/Asuncion'], ['Uruguay', 'America/Montevideo'], ['Guyana', 'America/Guyana'],
    ['Suriname', 'America/Paramaribo'], ['French Guiana', 'America/Cayenne'], ['Panama', 'America/Panama'],
    ['Costa Rica', 'America/Costa_Rica'], ['Nicaragua', 'America/Managua'],
    ['Honduras', 'America/Tegucigalpa'], ['El Salvador', 'America/El_Salvador'],
    ['Guatemala', 'America/Guatemala'], ['Belize', 'America/Belize'], ['Cuba', 'America/Havana'],
    ['Jamaica', 'America/Jamaica'], ['Haiti', 'America/Port-au-Prince'],
    ['Dominican Republic', 'America/Santo_Domingo'], ['Puerto Rico', 'America/Puerto_Rico'],
    ['Trinidad and Tobago', 'America/Port_of_Spain'], ['Barbados', 'America/Barbados'],
    ['Bahamas', 'America/Nassau'],
  ]],
  ['Africa', [
    ['South Africa', 'Africa/Johannesburg'], ['Nigeria', 'Africa/Lagos'], ['Egypt', 'Africa/Cairo'],
    ['Kenya', 'Africa/Nairobi'], ['Ethiopia', 'Africa/Addis_Ababa'], ['Ghana', 'Africa/Accra'],
    ['Tanzania', 'Africa/Dar_es_Salaam'], ['Uganda', 'Africa/Kampala'], ['Algeria', 'Africa/Algiers'],
    ['Morocco', 'Africa/Casablanca'], ['Tunisia', 'Africa/Tunis'], ['Libya', 'Africa/Tripoli'],
    ['Sudan', 'Africa/Khartoum'], ['South Sudan', 'Africa/Juba'], ['Cameroon', 'Africa/Douala'],
    ['Ivory Coast', 'Africa/Abidjan'], ['Senegal', 'Africa/Dakar'], ['Mali', 'Africa/Bamako'],
    ['Burkina Faso', 'Africa/Ouagadougou'], ['Niger', 'Africa/Niamey'], ['Chad', 'Africa/Ndjamena'],
    ['Angola', 'Africa/Luanda'], ['Mozambique', 'Africa/Maputo'], ['Zambia', 'Africa/Lusaka'],
    ['Zimbabwe', 'Africa/Harare'], ['Botswana', 'Africa/Gaborone'], ['Namibia', 'Africa/Windhoek'],
    ['Madagascar', 'Indian/Antananarivo'], ['Rwanda', 'Africa/Kigali'], ['Burundi', 'Africa/Bujumbura'],
    ['Somalia', 'Africa/Mogadishu'], ['Djibouti', 'Africa/Djibouti'], ['Eritrea', 'Africa/Asmara'],
  ]],
  ['Oceania', [
    ['Australia', 'Australia/Sydney'], ['New Zealand', 'Pacific/Auckland'], ['Fiji', 'Pacific/Fiji'],
    ['Papua New Guinea', 'Pacific/Port_Moresby'], ['Solomon Islands', 'Pacific/Guadalcanal'],
    ['Vanuatu', 'Pacific/Efate'], ['Samoa', 'Pacific/Apia'], ['Tonga', 'Pacific/Tongatapu'],
  ]],
];

/** `[{ group, options: [name] }]` — the shape the dropdown renders. */
export const REGION_GROUPS = GROUPS.map(([group, entries]) => ({
  group,
  options: entries.map(([name]) => name),
}));

export const REGIONS = GROUPS.flatMap(([, entries]) => entries.map(([name]) => name));

/**
 * Timezone per region. The broad names this app used before countries are kept
 * so accounts saved under them keep converting correctly rather than silently
 * falling back to the office clock.
 */
export const REGION_ZONES = {
  ...Object.fromEntries(GROUPS.flatMap(([, entries]) => entries)),
  'Southeast Asia': 'Asia/Kuala_Lumpur',
  'East Asia': 'Asia/Tokyo',
  'South Asia': 'Asia/Colombo',
  'North America': 'America/New_York',
  Oceania: 'Australia/Sydney',
  Europe: 'Europe/Berlin',
  Global: 'UTC',
};

export const DEFAULT_REGION = 'Malaysia';
