export const MATH_OPERATOR_GROUPS = [
  ["Arithmetic", [
    ["+", " + ", "Add"],
    ["−", " - ", "Subtract"],
    ["×", " * ", "Multiply"],
    ["÷", " / ", "Divide"],
    ["%", " % ", "Remainder"],
    ["xʸ", " ^ ", "Exponent"],
    ["( )", "()", "Group an expression"],
    ["[time]", "[1sec]", "Bracketed duration value"]
  ]],
  ["Bitwise", [
    ["AND", " & ", "Bitwise AND"],
    ["OR", " | ", "Bitwise OR"],
    ["XOR", " ! ", "Bitwise XOR"],
    ["NOT", "~", "Bitwise complement"],
    [">>", " > ", "Signed right shift"],
    ["<<", " < ", "Left shift"],
    [">>>", " $ ", "Unsigned right shift"]
  ]]
];

export const CONDITION_OPERATOR_GROUPS = [
  ["Logic", [
    ["AND", " && ", "Both conditions must match"],
    ["OR", " || ", "Either condition may match"],
    ["NOT", "!", "Negate a condition"],
    ["==", " == ", "Equals"],
    ["!=", " != ", "Does not equal"],
    [">", " > ", "Greater than"],
    ["<", " < ", "Less than"],
    [">=", " >= ", "At least"],
    ["<=", " <= ", "At most"],
    ["( )", "()", "Group conditions"],
    ["else", "else", "Always matches when reached. Keep it last"],
    ["true", "true", "Boolean true"],
    ["false", "false", "Boolean false"]
  ]],
  ["Context", [
    ["permission", "perm_", "Permission check. Replace dots in the permission with underscores"]
  ]]
];

export const MATH_FUNCTION_GROUPS = [
  ["Kingdoms functions", [
    fn("time", "time()", "Current Unix time in milliseconds"),
    fn("max", "max(, )", "Greatest of any number of arguments"),
    fn("min", "min(, )", "Smallest of any number of arguments"),
    fn("random", "random(, )", "Random decimal between minimum and maximum"),
    fn("randInt", "randInt(, )", "Random integer between minimum and maximum"),
    fn("whatPercentOf", "whatPercentOf(, )", "What percentage the first value is of the second"),
    fn("percentOf", "percentOf(, )", "First value percent of the second"),
    fn("naturalSum", "naturalSum()", "Sum of the natural numbers from 1 through n"),
    fn("reverse", "reverse()", "Reverse the bits of an integer"),
    fn("reverseBytes", "reverseBytes()", "Reverse the bytes of an integer"),
    fn("hash", "hash()", "Numeric hash code"),
    fn("identityHash", "identityHash()", "Numeric identity hash"),
    fn("log2", "log2()", "Base-2 logarithm")
  ]],
  ["Conditional functions", [
    fn("eq", "eq(, , , )", "Choose between two values when the first two are equal"),
    fn("ne", "ne(, , , )", "Choose between two values when the first two are not equal"),
    fn("gt", "gt(, , , )", "Choose between two values when the first is greater"),
    fn("lt", "lt(, , , )", "Choose between two values when the first is less"),
    fn("ge", "ge(, , , )", "Choose between two values when the first is at least the second"),
    fn("le", "le(, , , )", "Choose between two values when the first is at most the second")
  ]],
  ["Rounding and signs", [
    fn("abs", "abs()", "Absolute value"),
    fn("ceil", "ceil()", "Round upward"),
    fn("floor", "floor()", "Round downward"),
    fn("floorDiv", "floorDiv(, )", "Integer floor division"),
    fn("floorMod", "floorMod(, )", "Floor modulus"),
    fn("rint", "rint()", "Closest mathematical integer"),
    fn("round", "round()", "Round to the nearest integer"),
    fn("signum", "signum()", "Sign of a number"),
    fn("sign", "sign()", "Sign of a number"),
    fn("copySign", "copySign(, )", "Magnitude of the first value with the sign of the second")
  ]],
  ["Powers and logarithms", [
    fn("cbrt", "cbrt()", "Cube root"),
    fn("exp", "exp()", "Euler's number raised to a value"),
    fn("expm1", "expm1()", "e raised to a value, minus one"),
    fn("hypot", "hypot(, )", "Hypotenuse without intermediate overflow"),
    fn("log", "log()", "Natural logarithm"),
    fn("log10", "log10()", "Base-10 logarithm"),
    fn("log1p", "log1p()", "Natural logarithm of one plus a value"),
    fn("pow", "pow(, )", "First value raised to the second"),
    fn("scalb", "scalb(, )", "Scale by a power of two"),
    fn("sqrt", "sqrt()", "Square root")
  ]],
  ["Trigonometry", [
    fn("acos", "acos()", "Arc cosine"),
    fn("asin", "asin()", "Arc sine"),
    fn("atan", "atan()", "Arc tangent"),
    fn("atan2", "atan2(, )", "Angle from rectangular coordinates"),
    fn("cos", "cos()", "Cosine"),
    fn("cosh", "cosh()", "Hyperbolic cosine"),
    fn("sin", "sin()", "Sine"),
    fn("sinh", "sinh()", "Hyperbolic sine"),
    fn("tan", "tan()", "Tangent"),
    fn("tanh", "tanh()", "Hyperbolic tangent"),
    fn("toDegrees", "toDegrees()", "Radians to degrees"),
    fn("toRadians", "toRadians()", "Degrees to radians")
  ]],
  ["Floating-point helpers", [
    fn("getExponent", "getExponent()", "Unbiased exponent"),
    fn("IEEEremainder", "IEEEremainder(, )", "IEEE 754 remainder"),
    fn("nextAfter", "nextAfter(, )", "Adjacent value toward a direction"),
    fn("nextDown", "nextDown()", "Adjacent value toward negative infinity"),
    fn("nextUp", "nextUp()", "Adjacent value toward positive infinity"),
    fn("ulp", "ulp()", "Unit in the last place")
  ]]
];

const SIMPLE_PLACEHOLDERS = [
  ["Player", [
    "lang", "joined", "last_donation_time", "last_donation_amount", "total_donations", "tax",
    "claims", "max_claims", "power", "has_kingdom", "is_spy", "is_sneak_mode", "is_admin",
    "is_flying", "is_pvp", "is_invading", "rank_node", "rank_name", "rank_color", "rank_symbol",
    "rank_priority", "rank_max_claims", "nation_rank_node", "nation_rank_name", "nation_rank_color",
    "nation_rank_symbol", "nation_rank_priority", "map_width", "map_height", "chat_channel",
    "chat_channel_name", "chat_channel_short", "chat_channel_color", "distance_from_core", "land_relation"
  ]],
  ["Kingdom", [
    "kingdom_name", "lore", "kingdom_tag", "top_position", "members", "max_members", "online_members",
    "offline_members", "kingdom_flag", "kingdom_color", "king", "might", "since", "home", "nexus",
    "lands", "avg_lands_distance", "kingdom_power", "max_lands", "shield_since", "shield_time",
    "shield_time_left", "kingdom_resource_points", "bank", "ranks", "kingdom_is_pacifist",
    "kingdom_is_permanent", "kingdom_is_hidden", "kingdom_is_under_attack", "kingdom_is_invading",
    "kingdom_home_is_public", "kingdom_requires_invite", "mails_total", "max_lands_modifier",
    "server_kingdom_tax", "nation_tax", "kingdom_tax", "structures_total", "turrets_total",
    "total_war_points", "kingdom_bankruptcy"
  ]],
  ["Nation", [
    "nation_name", "nation_kingdoms", "nation_spawn", "nation_bank", "nation_since",
    "nation_resource_points", "nation_might", "nation_tax", "server_nation_tax",
    "nation_shield_since", "nation_shield_time", "nation_shield_time_left"
  ]],
  ["Relation", ["relation", "relation_name", "relation_color", "war_points"]],
  ["Land", ["land_total_turrets", "land_total_structures", "land_total_protected_blocks", "land_since", "land_by"]],
  ["Server", [
    "masswar_is_running", "masswar_time", "stats_kingdoms_count", "stats_nations_count",
    "stats_lands_count", "stats_lands_claimed", "stats_players_with_kingdom"
  ]]
];

const FUNCTIONAL_PLACEHOLDERS = [
  ["Player", [
    "%kingdoms_land:info name=<placeholder>%",
    "%kingdoms_taxes:evaluate name=<tax>%",
    "%kingdoms_var: name=<variable>%"
  ]],
  ["Kingdom", [
    "%kingdoms_member:sum of=<math>%",
    "%kingdoms_structures:count style=<name>%",
    "%kingdoms_turrets:count style=<name>%",
    "%kingdoms_kingdom_upgrade:level type=<type>, of=<name>%",
    "%kingdoms_kingdom_stat:of name=<statpath>, default=<value>%",
    "%kingdoms_taxes:eqn name=<tax>%"
  ]],
  ["Nation", [
    "%kingdoms_nation:capital get=<placeholder>%",
    "%kingdoms_nation:sum of=<placeholder>%",
    "%kingdoms_nation_zone:info name=<placeholder>%"
  ]],
  ["Land", [
    "%kingdoms_lands:info name=<placeholder>%"
  ]],
  ["Leaderboards", [
    "%kingdoms_kingdom_top:value pos=<position>, type=<top>%",
    "%kingdoms_kingdom_top:position type=<top>%",
    "%kingdoms_kingdom_top:isIncluded type=<top>%",
    "%kingdoms_kingdom_top:at pos=<position>, type=<top>, of=<placeholder>%",
    "%kingdoms_nation_top:value pos=<position>, type=<top>%",
    "%kingdoms_nation_top:position type=<top>%",
    "%kingdoms_nation_top:isIncluded type=<top>%",
    "%kingdoms_nation_top:at pos=<position>, type=<top>, of=<placeholder>%"
  ]]
];

export const DOCUMENTED_PLACEHOLDER_GROUPS = SIMPLE_PLACEHOLDERS.map(([label, names]) => [
  label,
  names.map((name) => [`%kingdoms_${name}%`, `${label} context`])
]).concat(FUNCTIONAL_PLACEHOLDERS.map(([label, values]) => [
  label,
  values.map((value) => [value, `${label} functional placeholder`])
]));

export const EXPRESSION_PLACEHOLDER_GROUPS = SIMPLE_PLACEHOLDERS.map(([label, names]) => [
  label,
  names.map((name) => [`kingdoms_${name}`, `kingdoms_${name}`, `${label} context`])
]);

export const PLACEHOLDER_MODIFIERS = [
  ["short", "Short number suffixes"],
  ["fancy", "Formatted number"],
  ["roman", "Roman numerals"],
  ["bool", "Localized enabled/disabled value"],
  ["time", "Configured duration format"],
  ["date", "Configured date format"]
];

export const DEFAULT_MACRO_GROUPS = [
  ["Colors", [
    "green", "white", "black", "gray", "pink", "purple", "orange", "gold", "blue", "red",
    "p", "sp", "desc", "s", "e", "es", "sep", "ssep", "LightSalmon", "Maroon", "Olive",
    "Teal", "Fuchsia", "Navy"
  ]],
  ["Symbols and shared text", [
    "err-sign", "info-sign", "cmd", "lvlup", "arrow", "point", "dot", "sdot", "colon",
    "note", "warning", "left-bracket", "right-bracket", "cancel", "usage", "enabled",
    "disabled", "currency-symbol", "ok", "yes", "no", "gui-back", "gui-add", "groupColor",
    "channel", "kingdomPrefix", "nationPrefix", "spy"
  ]],
  ["Default level messages", [
    "kingdom-lvl-II", "kingdom-lvl-III", "kingdom-lvl-IV", "kingdom-lvl-V",
    "chk-kingdom-lvl-II", "chk-kingdom-lvl-III", "chk-kingdom-lvl-IV", "chk-kingdom-lvl-V"
  ]]
].map(([label, names]) => [label, names.map((name) => [`{$${name}}`, "Configurable Kingdoms macro"])]);

function fn(label, insert, help) {
  return [label, insert, help];
}
