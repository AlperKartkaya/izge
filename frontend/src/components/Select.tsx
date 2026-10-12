import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import './select.css'

export type SelectOption = {
  value: string
  label: string
  disabled?: boolean
}

type SelectProps = {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  'aria-label': string
  id?: string
  name?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

const encodeValue = (value: string) => `value:${value}`
const decodeValue = (value: string) => value.slice('value:'.length)

export function Select({ value, onValueChange, options, className, ...props }: SelectProps) {
  const selectedLabel = options.find((option) => option.value === value)?.label

  return (
    <>
    {props.name ? <input type="hidden" name={props.name} value={value} disabled={props.disabled} /> : null}
    <SelectPrimitive.Root
      value={props.required && value === '' ? '' : encodeValue(value)}
      onValueChange={(nextValue) => onValueChange(decodeValue(nextValue))}
      required={props.required}
      disabled={props.disabled || options.length === 0}
    >
      <SelectPrimitive.Trigger
        id={props.id}
        aria-label={props['aria-label']}
        className={['select-trigger', className].filter(Boolean).join(' ')}
      >
        <SelectPrimitive.Value>{selectedLabel ?? '—'}</SelectPrimitive.Value>
        <SelectPrimitive.Icon className="select-trigger-icon"><ChevronDown aria-hidden="true" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="select-content" position="popper" sideOffset={6} collisionPadding={8}>
          <SelectPrimitive.ScrollUpButton className="select-scroll-button"><ChevronUp aria-hidden="true" /></SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={encodeValue(option.value)}
                value={encodeValue(option.value)}
                disabled={option.disabled}
                className="select-item"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="select-item-indicator"><Check aria-hidden="true" /></SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="select-scroll-button"><ChevronDown aria-hidden="true" /></SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
    </>
  )
}
