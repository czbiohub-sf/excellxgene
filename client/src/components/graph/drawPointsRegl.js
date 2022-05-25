import { glPointFlags, glPointSize } from "../../util/glHelpers";

export default function drawPointsRegl(regl, pointScaler=1.0) {
  return regl({
    vert: `

    float easeCubicInOut(float t) {
      t *= 2.0;
      t = (t <= 1.0 ? t * t * t : (t -= 2.0) * t * t + 2.0) / 2.0;

      if (t > 1.0) {
        t = 1.0;
      }

      return t;
    }

    precision mediump float;

    attribute vec2 positionsStart;
    attribute vec2 positionsEnd;
    attribute vec3 color;
    attribute float flag;

    uniform float distance;
    uniform mat3 projView;
    uniform float nPoints;
    uniform float minViewportDimension;
    uniform float duration;
    uniform float elapsed;

    varying lowp vec4 fragColor;

    const float zBottom = 0.99;
    const float zMiddle = 0.;
    const float zTop = -1.;

    // import getFlags()
    ${glPointFlags}

    // get pointSize()
    ${glPointSize}

    void main() {
      float t;
      if (duration == 0.0) {
        t = 1.0;
      } else {
        t = easeCubicInOut(elapsed / duration);
      }

      bool isBackground, isSelected, isHighlight, isHalfSelected, isInvisible;
      getFlags(flag, isBackground, isSelected, isHighlight, isHalfSelected, isInvisible);

      float size = pointSize(nPoints, minViewportDimension, isSelected, isHighlight, isHalfSelected, isInvisible);
      gl_PointSize = size * pow(distance, 0.5) * ${pointScaler*0.999};

      float z = (isBackground || isHalfSelected) ? zBottom : (isHighlight ? zTop : zMiddle);

      vec2 position = mix(positionsStart, positionsEnd, t);
      vec3 xy = projView * vec3(position, 1.);
      gl_Position = vec4(xy.xy, z, 1.);

      float a = (isBackground || isHalfSelected) ? 0.9 : 1.0;
      float alpha = isInvisible ? 0.0 : a;
      fragColor = vec4(color, alpha);
    }`,

    frag: `
    precision mediump float;
    varying lowp vec4 fragColor;
    void main() {
      if (length(gl_PointCoord.xy - 0.5) > 0.5) {
        discard;
      }
      gl_FragColor = fragColor;
    }`,

    attributes: {
      positionsStart: regl.prop("positionsStart"),
      positionsEnd: regl.prop("positionsEnd"),
      color: regl.prop("color"),
      flag: regl.prop("flag"),
    },

    uniforms: {
      distance: regl.prop("distance"),
      projView: regl.prop("projView"),
      nPoints: regl.prop("nPoints"),
      duration: regl.prop("duration"),
      minViewportDimension: regl.prop("minViewportDimension"),
      elapsed: ({ time }, { startTime = 0 }) => (time - startTime) * 1000,
    },

    count: regl.prop("count"),

    primitive: "points",

    blend: {
      enable: true,
      func: {
        srcRGB: "src alpha",
        srcAlpha: 1,
        dstRGB: 0,
        dstAlpha: "zero",
      },
    },
  });
}
