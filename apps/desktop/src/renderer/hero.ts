import { heroui } from '@heroui/react'

// HeroUI 主题桥接：主色 / 焦点色直接引用应用的强调色令牌。
// --accent 会在运行时被 applyAccent() 依据用户自定义颜色重写，
// 因此 HeroUI 组件（Switch / Tooltip / Progress 等）始终与应用主题保持一致。
// 十六进制默认值仅用于首帧解析，polish.css 中会以 --accent 覆盖 --heroui-primary。
export default heroui({
  themes: {
    dark: {
      colors: {
        primary: { DEFAULT: '#55d6b7', foreground: '#071b16' },
        focus: '#55d6b7'
      }
    },
    light: {
      colors: {
        primary: { DEFAULT: '#087864', foreground: '#ffffff' },
        focus: '#087864'
      }
    }
  }
})
